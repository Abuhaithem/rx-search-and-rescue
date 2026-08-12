/**
 * Formulary ingest: per-page vision extraction (provider-pluggable)
 * cross-checked against the PDF text layer, deterministic restriction
 * parsing, multi-strength expansion, cross-page dedup (exact repeats are
 * collapsed; same-name disagreements are flagged for review), and batch
 * insert.
 * Each extraction call receives a single-page sub-PDF; index/front-matter
 * pages are skipped up front by the deterministic text-layer classifier
 * (lib/page-classify) so no API call is spent on them. Pages that fail the
 * cross-check get one retry on the provider's escalation model before landing
 * in needs_review. Ends at status "qa" — an admin must resolve review rows
 * and activate.
 */
import {
  and,
  eq,
  formularies,
  formularyEntries,
  formularyLegends,
  inArray,
  isNotNull,
  sql,
} from "@rxsr/db";
import { parseRestrictions } from "@rxsr/core/formulary";
import type { FormularyIngestJob } from "../queues";
import {
  crossCheckFormularyPage,
  MISMATCH_CONFIDENCE,
  OK_CONFIDENCE,
} from "../lib/cross-check";
import { markJobDone, markJobFailed, markJobRunning, updateJobProgress } from "../lib/db";
import { entrySignature, expandStrengths, isBrandName } from "../lib/formulary";
import { classifyFormularyPage } from "../lib/page-classify";
import { createPageExtractor } from "../lib/pdf-chunk";
import { createJobDeps, type JobDeps } from "./deps";

const INSERT_BATCH_SIZE = 500;
/** The legend always sits in the front matter. */
const LEGEND_FRONT_MATTER_PAGES = 15;

export async function runFormularyIngest(
  job: FormularyIngestJob,
  deps: JobDeps = createJobDeps(),
): Promise<void> {
  const { db } = deps;
  await markJobRunning(db, job.ingestionJobId);
  try {
    await updateJobProgress(db, job.ingestionJobId, { message: "Downloading formulary PDF" });
    const pdfBytes = await deps.storage.download(job.storagePath);
    const textLayer = await deps.pdf.extractPageTexts(pdfBytes);
    const pages = await createPageExtractor(pdfBytes);

    await db
      .update(formularies)
      .set({ sourcePageCount: textLayer.totalPages })
      .where(eq(formularies.id, job.formularyId));

    // Re-ingest safety: replace any rows from a previous (failed) run.
    await db
      .delete(formularyEntries)
      .where(eq(formularyEntries.formularyId, job.formularyId));
    await db
      .delete(formularyLegends)
      .where(eq(formularyLegends.formularyId, job.formularyId));

    // Merged PDFs can hold several formularies: an optional page window
    // restricts this record's ingest to its own slice of the document.
    const windowStart = Math.max(1, job.pageStart ?? 1);
    const windowEnd = Math.min(textLayer.totalPages, job.pageEnd ?? textLayer.totalPages);

    let totalEntries = 0;
    let needsReviewCount = 0;
    let escalations = 0;
    let skippedPages = 0;
    let duplicatesSkipped = 0;
    const seenSignatures = new Set<string>();
    let pending: (typeof formularyEntries.$inferInsert)[] = [];

    const flush = async () => {
      if (pending.length === 0) return;
      await db.insert(formularyEntries).values(pending);
      pending = [];
    };

    for (let page = windowStart; page <= windowEnd; page++) {
      await updateJobProgress(db, job.ingestionJobId, {
        page,
        totalPages: windowEnd,
        message: `Extracting page ${page} of ${textLayer.totalPages}${
          skippedPages > 0 ? ` (${skippedPages} skipped)` : ""
        }${escalations > 0 ? ` (${escalations} escalations)` : ""}`,
      });

      const pageText = textLayer.pages[page - 1] ?? "";
      if (classifyFormularyPage(pageText) === "skip") {
        skippedPages += 1;
        continue;
      }

      const pageBase64 = await pages.pageBase64(page);
      let extracted = await deps.extractor.extractFormularyPage(pageBase64, 1);
      let check = crossCheckFormularyPage(extracted.rows, pageText);

      // One retry on the escalation model before rows land in needs_review.
      if (!check.ok && deps.extractor.escalationModel !== null) {
        escalations += 1;
        const retried = await deps.extractor.extractFormularyPage(pageBase64, 1, {
          model: deps.extractor.escalationModel,
        });
        const retriedCheck = crossCheckFormularyPage(retried.rows, pageText);
        if (retriedCheck.ok || retriedCheck.overlapRatio >= check.overlapRatio) {
          extracted = retried;
          check = retriedCheck;
        }
      }
      if (extracted.rows.length === 0) continue;

      const confidence = check.ok ? OK_CONFIDENCE : MISMATCH_CONFIDENCE;
      const needsReview = !check.ok;

      for (const row of extracted.rows) {
        const restrictions = parseRestrictions(row.requirementsText);
        for (const normalizedName of expandStrengths(row.rawDrugName)) {
          const signature = entrySignature({
            normalizedName,
            tier: row.tier,
            pa: restrictions.pa,
            st: restrictions.st,
            qlQuantity: restrictions.ql?.quantity ?? null,
            qlDays: restrictions.ql?.days ?? null,
            extraFlags: restrictions.extraFlags,
          });
          if (seenSignatures.has(signature)) {
            duplicatesSkipped += 1;
            continue;
          }
          seenSignatures.add(signature);
          pending.push({
            formularyId: job.formularyId,
            rawDrugName: row.rawDrugName,
            normalizedName,
            rxcuis: [],
            isBrand: isBrandName(row.rawDrugName),
            tier: row.tier,
            pa: restrictions.pa,
            st: restrictions.st,
            qlQuantity: restrictions.ql?.quantity ?? null,
            qlDays: restrictions.ql?.days ?? null,
            extraFlags: restrictions.extraFlags,
            rawRequirementsText: row.requirementsText,
            therapeuticCategory: row.therapeuticCategory,
            sourcePage: page,
            confidence: confidence.toFixed(3),
            needsReview,
          });
          totalEntries += 1;
          if (needsReview) needsReviewCount += 1;
        }
      }
      if (pending.length >= INSERT_BATCH_SIZE) await flush();
    }
    await flush();

    // Exact repeats were collapsed above, so a name that still appears more
    // than once carries a real disagreement (different tier or restrictions)
    // the extractor cannot adjudicate — every copy goes to human review.
    const conflictedNames = (
      await db
        .select({ normalizedName: formularyEntries.normalizedName })
        .from(formularyEntries)
        .where(
          and(
            eq(formularyEntries.formularyId, job.formularyId),
            isNotNull(formularyEntries.normalizedName),
          ),
        )
        .groupBy(formularyEntries.normalizedName)
        .having(sql`count(*) > 1`)
    )
      .map((row) => row.normalizedName)
      .filter((name): name is string => name !== null);
    if (conflictedNames.length > 0) {
      await db
        .update(formularyEntries)
        .set({ needsReview: true })
        .where(
          and(
            eq(formularyEntries.formularyId, job.formularyId),
            inArray(formularyEntries.normalizedName, conflictedNames),
          ),
        );
      const [reviewCount] = await db
        .select({ value: sql<number>`count(*)::int` })
        .from(formularyEntries)
        .where(
          and(
            eq(formularyEntries.formularyId, job.formularyId),
            eq(formularyEntries.needsReview, true),
          ),
        );
      needsReviewCount = reviewCount?.value ?? needsReviewCount;
    }

    await updateJobProgress(db, job.ingestionJobId, {
      page: textLayer.totalPages,
      totalPages: textLayer.totalPages,
      message: "Extracting abbreviation legend",
    });
    const legendSource = await pages.rangeBase64(
      windowStart,
      Math.min(windowStart + LEGEND_FRONT_MATTER_PAGES - 1, windowEnd),
    );
    const legend = await deps.extractor.extractFormularyLegend(legendSource);
    if (legend.entries.length > 0) {
      await db.insert(formularyLegends).values(
        legend.entries.map((entry) => ({
          formularyId: job.formularyId,
          code: entry.code,
          definition: entry.definition,
        })),
      );
    }

    // Plan names off the cover/front matter — wizard prefill only, never fatal.
    const extractedPlanNames = await deps.extractor
      .extractFormularyPlanNames(legendSource)
      .then((r) => r.planNames)
      .catch(() => []);

    await db
      .update(formularies)
      .set({
        stats: {
          totalEntries,
          needsReview: needsReviewCount,
          skippedPages,
          duplicatesSkipped,
          nameConflicts: conflictedNames.length,
          extractedPlanNames,
        },
        status: "qa",
      })
      .where(eq(formularies.id, job.formularyId));

    await markJobDone(db, job.ingestionJobId, {
      page: textLayer.totalPages,
      totalPages: textLayer.totalPages,
      message: `Extracted ${totalEntries} entries (${needsReviewCount} need review, ${duplicatesSkipped} duplicate rows collapsed, ${escalations} pages escalated, ${skippedPages} non-table pages skipped)`,
    });
  } catch (error) {
    await markJobFailed(db, job.ingestionJobId, error);
    throw error;
  }
}
