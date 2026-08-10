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
      for (const tier of block.tiers) {
        if (tier.label) tierLabels[`t${tier.tier}`] = tier.label;
        for (const cost of tier.costs) {
          if (!cost.covered) continue;
          inserts.push({
            planId: plan.id,
            channel: cost.channel,
            tier: `t${tier.tier}` as CostTier,
            daysSupply: cost.daysSupply,
            copayCents: cost.copayCents,
            coinsurancePct: cost.coinsurancePct === null ? null : String(cost.coinsurancePct),
            maxCents: cost.maxCents,
            staged: true,
            sourceNote: `SoB import (${job.storagePath.split("/").pop()})`,
          });
        }
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
      if (inserts.length > 0) await db.insert(planTierCosts).values(inserts);

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
