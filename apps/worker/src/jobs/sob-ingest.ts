/**
 * Summary of Benefits ingest: AI-extract per-plan drug cost sharing from an
 * SBC PDF and STAGE it — tier costs land with staged=true, plan-level values
 * (premium, deductible, tier labels) land in plans.sobStaged. Nothing touches
 * live data until the wizard's Finalize applies it. One document may cover
 * several plans; extracted blocks map to the job's target plans by name, or
 * positionally when both sides have exactly one.
 */
import { and, eq, inArray, plans, planTierCosts } from "@rxsr/db";
import type { SobIngestJob } from "../queues";
import { markJobDone, markJobFailed, markJobRunning, updateJobProgress } from "../lib/db";
import { createJobDeps, type JobDeps } from "./deps";

type CostTier = "t1" | "t2" | "t3" | "t4" | "t5" | "t6" | "insulin";

const normalize = (name: string): string =>
  name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export async function runSobIngest(
  job: SobIngestJob,
  deps: JobDeps = createJobDeps(),
): Promise<void> {
  const { db } = deps;
  await markJobRunning(db, job.ingestionJobId);
  try {
    await updateJobProgress(db, job.ingestionJobId, { message: "Downloading Summary of Benefits" });
    const pdfBytes = await deps.storage.download(job.storagePath);

    await updateJobProgress(db, job.ingestionJobId, { message: "Extracting cost sharing" });
    const extraction = await deps.extractor.extractSummaryOfBenefits(
      Buffer.from(pdfBytes).toString("base64"),
    );

    const targetPlans = await db
      .select()
      .from(plans)
      .where(inArray(plans.id, job.planIds));
    const warnings: string[] = [];
    let plansStaged = 0;

    for (const plan of targetPlans) {
      const block =
        extraction.plans.find((p) => normalize(p.planName) === normalize(plan.name)) ??
        extraction.plans.find((p) => {
          const a = normalize(p.planName);
          const b = normalize(plan.name);
          return a.includes(b) || b.includes(a);
        }) ??
        (extraction.plans.length === 1 && targetPlans.length === 1
          ? extraction.plans[0]
          : undefined);
      if (!block) {
        warnings.push(`No SoB section matched plan "${plan.name}"`);
        continue;
      }

      // Replace this plan's previous staged rows, never its live ones.
      await db
        .delete(planTierCosts)
        .where(and(eq(planTierCosts.planId, plan.id), eq(planTierCosts.staged, true)));

      const inserts: (typeof planTierCosts.$inferInsert)[] = [];
      const tierLabels: Record<string, string> = {};
      let bothFieldsFixed = 0;
      for (const tier of block.tiers) {
        if (tier.label) tierLabels[`t${tier.tier}`] = tier.label;
        for (const cost of tier.costs) {
          if (!cost.covered) continue;
          // A cell is a copay OR a coinsurance, never both. When the model
          // sets both, a $0 copay is noise beside the percentage, and a
          // positive copay is a misplaced per-fill cap ("25% up to $35").
          let copayCents = cost.copayCents;
          let maxCents = cost.maxCents;
          if (copayCents !== null && cost.coinsurancePct !== null) {
            if (copayCents > 0 && maxCents === null) maxCents = copayCents;
            copayCents = null;
            bothFieldsFixed += 1;
          }
          inserts.push({
            planId: plan.id,
            channel: cost.channel,
            tier: `t${tier.tier}` as CostTier,
            daysSupply: cost.daysSupply,
            copayCents,
            coinsurancePct: cost.coinsurancePct === null ? null : String(cost.coinsurancePct),
            maxCents,
            staged: true,
            sourceNote: `SoB import (${job.storagePath.split("/").pop()})`,
          });
        }
      }
      if (bothFieldsFixed > 0) {
        warnings.push(`${plan.name}: ${bothFieldsFixed} cells had copay+coinsurance — kept the coinsurance`);
      }
      if (block.insulinCapCents !== null) {
        const channels = [...new Set(inserts.map((i) => i.channel))];
        for (const channel of channels) {
          inserts.push({
            planId: plan.id,
            channel,
            tier: "insulin",
            daysSupply: 30,
            copayCents: block.insulinCapCents,
            coinsurancePct: null,
            maxCents: null,
            staged: true,
            sourceNote: "SoB import (insulin cap)",
          });
        }
      }
      // The extractor can map two document columns onto one canonical
      // channel (e.g. both mail columns → preferred_mail when amounts tie).
      // The unique index (plan, channel, tier, supply) would reject the
      // batch — dedupe first-wins and surface the count instead of failing.
      const seenKeys = new Set<string>();
      const deduped = inserts.filter((row) => {
        const key = `${row.channel}:${row.tier}:${row.daysSupply}`;
        if (seenKeys.has(key)) return false;
        seenKeys.add(key);
        return true;
      });
      if (deduped.length < inserts.length) {
        warnings.push(
          `${plan.name}: ${inserts.length - deduped.length} duplicate channel/tier cells dropped`,
        );
      }
      if (deduped.length > 0) await db.insert(planTierCosts).values(deduped);

      await db
        .update(plans)
        .set({
          sobPath: job.storagePath,
          sobStaged: {
            premiumCents: block.premiumCents,
            rxDeductibleCents: block.rxDeductibleCents,
            deductibleTiers: block.deductibleTiers,
            tierLabels,
          },
        })
        .where(eq(plans.id, plan.id));
      plansStaged += 1;
    }

    await markJobDone(db, job.ingestionJobId, {
      message: [
        `Staged cost sharing for ${plansStaged} of ${job.planIds.length} plans`,
        warnings.length > 0 ? `warnings: ${warnings.join(" · ")}` : null,
      ]
        .filter(Boolean)
        .join("; "),
    });
  } catch (error) {
    await markJobFailed(db, job.ingestionJobId, error);
    throw error;
  }
}
