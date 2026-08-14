/**
 * Plan pharmacy directory ingest: text-layer extraction (directories are
 * text-heavy tables), Claude row extraction per page chunk, deterministic
 * matching against the pharmacies table, and carrier_pharmacy_networks
 * upserts with source "directory" — the network belongs to the CARRIER and
 * covers all of its plans. Directory rows with no DB match CREATE the
 * pharmacies row — carrier files are the source of pharmacy truth.
 */
import { and, carrierPharmacyNetworks, eq, pharmacies, sql } from "@rxsr/db";
import { matchPharmacy, type ParsedPharmacyText } from "@rxsr/core/pharmacy";
import type { PharmacyDirectoryJob } from "../queues";
import { markJobDone, markJobFailed, markJobRunning, updateJobProgress } from "../lib/db";
import { candidateFromPharmacyRow, ensureBrandId, loadZipCandidates } from "../lib/pharmacies";
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
    let unspecified = 0;

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
        const best = matchPharmacy(parsed, dbRows.map(candidateFromPharmacyRow))[0];

        // Carriers name cost-share tiers inconsistently; "unspecified" means the
        // directory listed the pharmacy in-network with no tier language. Map it
        // to "standard" — the conservative choice that never overstates savings.
        const status = row.status === "unspecified" ? "standard" : row.status;
        if (row.status === "unspecified") unspecified += 1;

        let pharmacyId: string;
        if (best && best.score >= DIRECTORY_LINK_THRESHOLD) {
          pharmacyId = best.candidate.id;
        } else {
          // Unknown pharmacy: the directory row itself is the record of truth.
          // Exact-match guard keeps re-ingests from planting duplicates when
          // the fuzzy matcher scores below the link threshold.
          const [existing] = await db
            .select({ id: pharmacies.id })
            .from(pharmacies)
            .where(and(eq(pharmacies.name, row.pharmacyName), eq(pharmacies.zip, zip)))
            .limit(1);
          if (existing) {
            pharmacyId = existing.id;
          } else {
            const [inserted] = await db
              .insert(pharmacies)
              .values({
                name: row.pharmacyName,
                brandId: await ensureBrandId(db, row.pharmacyName),
                address1: row.address,
                zip,
                source: "directory",
              })
              .returning({ id: pharmacies.id });
            if (!inserted) {
              skipped += 1;
              continue;
            }
            pharmacyId = inserted.id;
          }
        }
        await db
          .insert(carrierPharmacyNetworks)
          .values({
            carrierId: job.carrierId,
            planYear: job.planYear,
            pharmacyId,
            status,
            source: "directory",
            staged: job.staged ?? false,
          })
          .onConflictDoUpdate({
            target: [
              carrierPharmacyNetworks.carrierId,
              carrierPharmacyNetworks.planYear,
              carrierPharmacyNetworks.pharmacyId,
            ],
            set: { status, source: "directory", staged: job.staged ?? false },
            // Agent-set rows outrank every automated source.
            setWhere: sql`${carrierPharmacyNetworks.source} <> 'agent'`,
          });
        linked += 1;
      }
    }

    await markJobDone(db, job.ingestionJobId, {
      page: textLayer.totalPages,
      totalPages: textLayer.totalPages,
      message: `Linked ${linked} pharmacies (${skipped} unmatched skipped, ${unspecified} without tier language recorded as standard)`,
    });
  } catch (error) {
    await markJobFailed(db, job.ingestionJobId, error);
    throw error;
  }
}
