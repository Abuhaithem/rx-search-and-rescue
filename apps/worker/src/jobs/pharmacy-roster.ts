/**
 * Statewide pharmacy roster ingest → the MASTER pharmacy list. Text-layer
 * chunks go through LLM row extraction (roster tables are text-heavy);
 * rows upsert into the pharmacies table on name+ZIP identity with a brand
 * assigned, so re-ingesting an updated roster refreshes addresses instead of
 * duplicating. Carrier network files map onto these rows afterwards.
 */
import { and, eq, pharmacies, sql } from "@rxsr/db";
import type { PharmacyRosterJob } from "../queues";
import { markJobDone, markJobFailed, markJobRunning, updateJobProgress } from "../lib/db";
import { ensureBrandId } from "../lib/pharmacies";
import { createJobDeps, type JobDeps } from "./deps";

const PAGES_PER_CHUNK = 4;

export async function runPharmacyRoster(
  job: PharmacyRosterJob,
  deps: JobDeps = createJobDeps(),
): Promise<void> {
  const { db } = deps;
  await markJobRunning(db, job.ingestionJobId);
  try {
    await updateJobProgress(db, job.ingestionJobId, { message: "Downloading roster PDF" });
    const pdfBytes = await deps.storage.download(job.storagePath);
    const textLayer = await deps.pdf.extractPageTexts(pdfBytes);
    const state = job.state.toUpperCase();

    let inserted = 0;
    let updated = 0;
    let skipped = 0;

    for (let start = 0; start < textLayer.totalPages; start += PAGES_PER_CHUNK) {
      const end = Math.min(start + PAGES_PER_CHUNK, textLayer.totalPages);
      await updateJobProgress(db, job.ingestionJobId, {
        page: end,
        totalPages: textLayer.totalPages,
        message: `Extracting roster pages ${start + 1}–${end}`,
      });

      const chunkText = textLayer.pages
        .slice(start, end)
        .map((text, i) => `--- page ${start + i + 1} ---\n${text}`)
        .join("\n\n");
      if (chunkText.trim() === "") continue;

      const { rows } = await deps.extractor.extractPharmacyRosterRows(chunkText);

      for (const row of rows) {
        const zip = row.zip?.match(/\d{5}/)?.[0] ?? null;
        const name = row.name.replace(/[†*]/g, "").trim();
        if (!zip || name.length < 2) {
          skipped += 1;
          continue;
        }

        const [existing] = await db
          .select({ id: pharmacies.id })
          .from(pharmacies)
          .where(and(sql`lower(${pharmacies.name}) = ${name.toLowerCase()}`, eq(pharmacies.zip, zip)))
          .limit(1);

        if (existing) {
          await db
            .update(pharmacies)
            .set({
              address1: row.address,
              city: row.city,
              state,
              brandId: await ensureBrandId(db, name),
            })
            .where(eq(pharmacies.id, existing.id));
          updated += 1;
        } else {
          await db.insert(pharmacies).values({
            name,
            brandId: await ensureBrandId(db, name),
            address1: row.address,
            city: row.city,
            state,
            zip,
            source: "roster",
          });
          inserted += 1;
        }
      }
    }

    await markJobDone(db, job.ingestionJobId, {
      page: textLayer.totalPages,
      totalPages: textLayer.totalPages,
      message: `Roster imported: ${inserted} pharmacies added, ${updated} updated, ${skipped} rows skipped (no ZIP/name)`,
    });
  } catch (error) {
    await markJobFailed(db, job.ingestionJobId, error);
    throw error;
  }
}
