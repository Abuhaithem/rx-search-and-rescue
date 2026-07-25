/**
 * Seed the pharmacies table from the NPPES registry for one state.
 * The public API caps limit at 200 and skip at 1000, so one criteria set
 * yields at most 1200 rows — enough for agency-market states; ZIP-level
 * lookups during intake fill any gaps on demand.
 */
import { pharmacies } from "@rxsr/db";
import type { NppesSeedJob } from "../queues";
import { markJobDone, markJobFailed, markJobRunning, updateJobProgress } from "../lib/db";
import { NPPES_MAX_SKIP, NPPES_PAGE_LIMIT } from "../lib/nppes";
import { createJobDeps, type JobDeps } from "./deps";

export async function runNppesSeed(
  job: NppesSeedJob,
  deps: JobDeps = createJobDeps(),
): Promise<void> {
  const { db } = deps;
  await markJobRunning(db, job.ingestionJobId);
  try {
    let skip = 0;
    let total = 0;

    for (;;) {
      await updateJobProgress(db, job.ingestionJobId, {
        message: `Fetching NPPES pharmacies for ${job.state} (${total} so far)`,
      });
      const candidates = await deps.nppes.searchPharmacies({
        state: job.state,
        limit: NPPES_PAGE_LIMIT,
        skip,
      });

      for (const candidate of candidates) {
        if (candidate.npi === null) continue;
        await db
          .insert(pharmacies)
          .values({
            npi: candidate.npi,
            name: candidate.name,
            address1: candidate.address1,
            city: candidate.city,
            state: candidate.state,
            zip: candidate.zip,
            source: "nppes",
          })
          .onConflictDoUpdate({
            target: pharmacies.npi,
            set: {
              name: candidate.name,
              address1: candidate.address1,
              city: candidate.city,
              state: candidate.state,
              zip: candidate.zip,
              source: "nppes",
            },
          });
      }
      total += candidates.length;

      if (candidates.length < NPPES_PAGE_LIMIT) break;
      skip += NPPES_PAGE_LIMIT;
      if (skip > NPPES_MAX_SKIP) break;
    }

    await markJobDone(db, job.ingestionJobId, {
      message: `Seeded ${total} ${job.state} pharmacies from NPPES`,
    });
  } catch (error) {
    await markJobFailed(db, job.ingestionJobId, error);
    throw error;
  }
}
