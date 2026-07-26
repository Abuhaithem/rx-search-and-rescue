/**
 * Formulary ingest: per-page vision extraction (provider-pluggable)
 * cross-checked against the PDF text layer, deterministic restriction
 * parsing, multi-strength expansion, RxNorm normalization, and batch insert.
 * Small-context providers receive per-chunk sub-PDFs (lib/pdf-chunk); pages
 * that fail the cross-check get one retry on the provider's escalation model
 * before landing in needs_review. Ends at status "qa" — an admin must resolve
 * review rows and activate.
 */
import { eq, formularies, formularyEntries, formularyLegends } from "@rxsr/db";
import { parseRestrictions } from "@rxsr/core/formulary";
import type { FormularyIngestJob } from "../queues";
import {
  crossCheckFormularyPage,
  MISMATCH_CONFIDENCE,
  OK_CONFIDENCE,
} from "../lib/cross-check";
import { markJobDone, markJobFailed, markJobRunning, updateJobProgress } from "../lib/db";
import { expandStrengths, isBrandName } from "../lib/formulary";
import { chunkForPage, chunkPdf } from "../lib/pdf-chunk";
import { createJobDeps, type JobDeps } from "./deps";

const INSERT_BATCH_SIZE = 500;

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
    const chunks = await chunkPdf(pdfBytes, deps.extractor.maxContextPages);

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

    let totalEntries = 0;
    let needsReviewCount = 0;
    let escalations = 0;
    let pending: (typeof formularyEntries.$inferInsert)[] = [];

    const flush = async () => {
      if (pending.length === 0) return;
      await db.insert(formularyEntries).values(pending);
      pending = [];
    };

    for (let page = 1; page <= textLayer.totalPages; page++) {
      await updateJobProgress(db, job.ingestionJobId, {
        page,
        totalPages: textLayer.totalPages,
        message: `Extracting page ${page} of ${textLayer.totalPages}${
          escalations > 0 ? ` (${escalations} escalations)` : ""
        }`,
      });

      const { chunk, relativePage } = chunkForPage(chunks, page);
      const pageText = textLayer.pages[page - 1] ?? "";

      let extracted = await deps.extractor.extractFormularyPage(
        chunk.base64,
        relativePage,
      );
      let check = crossCheckFormularyPage(extracted.rows, pageText);

      // One retry on the escalation model before rows land in needs_review.
      if (!check.ok && deps.extractor.escalationModel !== null) {
        escalations += 1;
        const retried = await deps.extractor.extractFormularyPage(
          chunk.base64,
          relativePage,
          { model: deps.extractor.escalationModel },
        );
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
          const rxcui = await deps.rxnorm
            .findRxcuiByString(normalizedName)
            .catch(() => null);
          pending.push({
            formularyId: job.formularyId,
            rawDrugName: row.rawDrugName,
            normalizedName,
            rxcuis: rxcui !== null ? [rxcui] : [],
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

    await updateJobProgress(db, job.ingestionJobId, {
      page: textLayer.totalPages,
      totalPages: textLayer.totalPages,
      message: "Extracting abbreviation legend",
    });
    // The legend lives in the front matter — the first chunk always covers it
    // (and equals the whole document for unchunked providers).
    const legendSource = chunks[0]?.base64 ?? Buffer.from(pdfBytes).toString("base64");
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

    await db
      .update(formularies)
      .set({
        stats: { totalEntries, needsReview: needsReviewCount },
        status: "qa",
      })
      .where(eq(formularies.id, job.formularyId));

    await markJobDone(db, job.ingestionJobId, {
      page: textLayer.totalPages,
      totalPages: textLayer.totalPages,
      message: `Extracted ${totalEntries} entries (${needsReviewCount} need review, ${escalations} pages escalated)`,
    });
  } catch (error) {
    await markJobFailed(db, job.ingestionJobId, error);
    throw error;
  }
}
