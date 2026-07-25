/**
 * Plan pharmacy directory ingest: text-layer extraction (directories are
 * text-heavy tables), Claude row extraction per page chunk, deterministic
 * matching against known + NPPES pharmacies, and plan_pharmacy_networks
 * upserts with source "directory".
 */
import { planPharmacyNetworks } from "@rxsr/db";
import { matchPharmacy, type ParsedPharmacyText } from "@rxsr/core/pharmacy";
import type { PharmacyDirectoryJob } from "../queues";
import { markJobDone, markJobFailed, markJobRunning, updateJobProgress } from "../lib/db";
import {
  ensurePharmacyId,
  loadZipCandidates,
  mergeCandidates,
} from "../lib/pharmacies";
import { createJobDeps, type JobDeps } from "./deps";

const PAGES_PER_CHUNK = 4;
/** Below this score a directory row is skipped rather than mislinked. */
const DIRECTORY_LINK_THRESHOLD = 0.6;

export async function runPharmacyDirectory(
  job: PharmacyDirectoryJob,
  deps: JobDeps = createJobDeps(),
): Promise<void> {
  const { db } = deps;
  await markJobRunning(db, job.ingestionJobId);
  try {
    await updateJobProgress(db, job.ingestionJobId, { message: "Downloading directory PDF" });
    const pdfBytes = await deps.storage.download(job.storagePath);
    const textLayer = await deps.pdf.extractPageTexts(pdfBytes);

    let linked = 0;
    let skipped = 0;

    for (let start = 0; start < textLayer.totalPages; start += PAGES_PER_CHUNK) {
      const end = Math.min(start + PAGES_PER_CHUNK, textLayer.totalPages);
      await updateJobProgress(db, job.ingestionJobId, {
        page: end,
        totalPages: textLayer.totalPages,
        message: `Extracting directory pages ${start + 1}–${end}`,
      });

      const chunkText = textLayer.pages
        .slice(start, end)
        .map((text, i) => `--- page ${start + i + 1} ---\n${text}`)
        .join("\n\n");
      if (chunkText.trim() === "") continue;

      const { rows } = await deps.extractor.extractPharmacyDirectoryRows(chunkText);

      for (const row of rows) {
        const zip = row.zip?.slice(0, 5) ?? null;
        if (!zip) {
          skipped += 1;
          continue;
        }
        const parsed: ParsedPharmacyText = {
          name: row.pharmacyName,
          street: row.address,
          city: null,
          state: null,
          zip,
          raw: `${row.pharmacyName} ${row.address ?? ""} ${zip}`.trim(),
        };
        const dbRows = await loadZipCandidates(db, zip);
        const nppesCandidates = await deps.nppes
          .searchPharmacies({ zip })
          .catch(() => []);
        const pool = mergeCandidates(dbRows, nppesCandidates);
        const best = matchPharmacy(parsed, pool.candidates)[0];
        if (!best || best.score < DIRECTORY_LINK_THRESHOLD) {
          skipped += 1;
          continue;
        }

        const pharmacyId = await ensurePharmacyId(db, best.candidate, pool);
        await db
          .insert(planPharmacyNetworks)
          .values({
            planId: job.planId,
            pharmacyId,
            status: row.status,
            source: "directory",
          })
          .onConflictDoUpdate({
            target: [planPharmacyNetworks.planId, planPharmacyNetworks.pharmacyId],
            set: { status: row.status, source: "directory" },
          });
        linked += 1;
      }
    }

    await markJobDone(db, job.ingestionJobId, {
      page: textLayer.totalPages,
      totalPages: textLayer.totalPages,
      message: `Linked ${linked} pharmacies (${skipped} rows skipped as unmatched)`,
    });
  } catch (error) {
    await markJobFailed(db, job.ingestionJobId, error);
    throw error;
  }
}
