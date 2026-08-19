/**
 * AI brand tidy: merge brand-name variants of the same chain so the
 * comparison picker shows one card per chain ("Sav-On Pharmacy" +
 * "Albertsons Sav-On Pharmacy" → one brand). Merging only changes DISPLAY
 * grouping — pharmacy identity, network rows, and client links are
 * untouched, so a wrong merge is recoverable by editing brands in the admin
 * table. Also assigns a brand to any location that lacks one.
 */
import { eq, inArray, isNull, pharmacies, pharmacyBrands, sql } from "@rxsr/db";
import type { PharmacyBrandTidyJob } from "../queues";
import { markJobDone, markJobFailed, markJobRunning, updateJobProgress } from "../lib/db";
import { ensureBrandId } from "../lib/pharmacies";
import { createJobDeps, type JobDeps } from "./deps";

/** Brand names per LLM judgment call. */
const GROUPING_BATCH_SIZE = 250;

export async function runPharmacyBrandTidy(
  job: PharmacyBrandTidyJob,
  deps: JobDeps = createJobDeps(),
): Promise<void> {
  const { db } = deps;
  await markJobRunning(db, job.ingestionJobId);
  try {
    // 1. Locations without a brand get one deterministically first.
    await updateJobProgress(db, job.ingestionJobId, { message: "Assigning missing brands" });
    const brandless = await db
      .select({ id: pharmacies.id, name: pharmacies.name })
      .from(pharmacies)
      .where(isNull(pharmacies.brandId));
    let brandlessFixed = 0;
    for (const row of brandless) {
      const brandId = await ensureBrandId(db, row.name);
      if (brandId) {
        await db.update(pharmacies).set({ brandId }).where(eq(pharmacies.id, row.id));
        brandlessFixed += 1;
      }
    }

    // 2. The LLM judges which brand names are the same chain.
    const brands = await db
      .select({
        id: pharmacyBrands.id,
        name: pharmacyBrands.name,
        locationCount: sql<number>`(
          select count(*)::int from ${pharmacies} p where p.brand_id = ${pharmacyBrands.id}
        )`,
      })
      .from(pharmacyBrands)
      .orderBy(pharmacyBrands.name);

    let merges = 0;
    let locationsMoved = 0;

    for (let start = 0; start < brands.length; start += GROUPING_BATCH_SIZE) {
      const batch = brands.slice(start, start + GROUPING_BATCH_SIZE);
      if (batch.length < 2) break;
      await updateJobProgress(db, job.ingestionJobId, {
        message: `Reviewing brands ${start + 1}–${start + batch.length} of ${brands.length}`,
      });

      const prompt = [
        "Pharmacy brand names:",
        ...batch.map((b, index) => `${index}. ${b.name}`),
      ].join("\n");
      // A failed judgment call skips the batch — tidy is never fatal.
      const grouping = await deps.extractor.groupPharmacyBrands(prompt).catch(() => null);
      if (!grouping) continue;

      for (const group of grouping.groups) {
        const members = [...new Set(group.memberIndexes)]
          .filter((index) => index >= 0 && index < batch.length)
          .map((index) => batch[index]!);
        if (members.length < 2) continue;

        // Survivor: the member matching the LLM's canonical name, else the
        // member with the most locations — never a name outside the group.
        const canonical =
          members.find(
            (m) => m.name.toLowerCase() === group.canonicalName.toLowerCase(),
          ) ?? members.reduce((a, b) => (b.locationCount > a.locationCount ? b : a));
        const losers = members.filter((m) => m.id !== canonical.id);
        if (losers.length === 0) continue;

        const loserIds = losers.map((m) => m.id);
        const moved = await db
          .update(pharmacies)
          .set({ brandId: canonical.id })
          .where(inArray(pharmacies.brandId, loserIds))
          .returning({ id: pharmacies.id });
        await db.delete(pharmacyBrands).where(inArray(pharmacyBrands.id, loserIds));
        merges += losers.length;
        locationsMoved += moved.length;
      }
    }

    await markJobDone(db, job.ingestionJobId, {
      message: `Brands tidied: ${merges} variant names merged, ${locationsMoved} locations regrouped, ${brandlessFixed} brandless locations fixed`,
    });
  } catch (error) {
    await markJobFailed(db, job.ingestionJobId, error);
    throw error;
  }
}
