/**
 * CMS quarterly PDP file import — the authoritative source for per-plan
 * pharmacy network status and cost-sharing prefill.
 * Precedence rules:
 *   - plan_pharmacy_networks: upsert with source "cms", but rows with source
 *     "agent" are NEVER overwritten (agent overrides win).
 *   - plan_tier_costs: INSERT-ONLY prefill — any existing (channel, tier,
 *     daysSupply) row (admin-typed/verified or earlier import) is kept.
 * Scoping: only plans of the job's planYear with a contractPlanId, and only
 * pharmacy NPIs already present in our pharmacies table.
 */
import {
  and,
  eq,
  inArray,
  isNotNull,
  pharmacies,
  planPharmacyNetworks,
  plans,
  planTierCosts,
  sql,
} from "@rxsr/db";
import { tierFromNumber } from "@rxsr/core";
import type { CmsImportJob } from "../queues";
import {
  contractPlanKey,
  decideCostInserts,
  decideNetworkActions,
  parseContractPlanId,
  type CostCandidate,
  type NetworkCandidate,
} from "../lib/cms";
import { downloadToTemp, scanCmsZip } from "../lib/cms-archive";
import { markJobDone, markJobFailed, markJobRunning, updateJobProgress } from "../lib/db";
import { createJobDeps, type JobDeps } from "./deps";

export async function runCmsImport(
  job: CmsImportJob,
  deps: JobDeps = createJobDeps(),
): Promise<void> {
  const { db } = deps;
  await markJobRunning(db, job.ingestionJobId);
  let archive: Awaited<ReturnType<typeof downloadToTemp>> | null = null;
  try {
    // ── Target plans ────────────────────────────────────────────────────────
    const yearPlans = await db
      .select({ id: plans.id, name: plans.name, contractPlanId: plans.contractPlanId })
      .from(plans)
      .where(and(eq(plans.planYear, job.planYear), isNotNull(plans.contractPlanId)));
    const allYearPlansCount = await db.$count(plans, eq(plans.planYear, job.planYear));

    const keyToPlanId = new Map<string, string>();
    const unparsable: string[] = [];
    for (const plan of yearPlans) {
      const parsed = parseContractPlanId(plan.contractPlanId);
      if (!parsed) {
        unparsable.push(`${plan.name} ("${plan.contractPlanId ?? ""}")`);
        continue;
      }
      keyToPlanId.set(contractPlanKey(parsed.contract, parsed.plan), plan.id);
    }
    const plansSkipped = allYearPlansCount - keyToPlanId.size;
    if (unparsable.length > 0) {
      console.warn(`[cms-import] unparsable contractPlanId: ${unparsable.join("; ")}`);
    }
    if (keyToPlanId.size === 0) {
      await markJobDone(db, job.ingestionJobId, {
        message: `No ${job.planYear} plans with a parseable contractPlanId — nothing to import (${plansSkipped} plans skipped)`,
      });
      return;
    }

    const npiRows = await db
      .select({ id: pharmacies.id, npi: pharmacies.npi })
      .from(pharmacies)
      .where(isNotNull(pharmacies.npi));
    const npiToPharmacyId = new Map(
      npiRows.filter((r): r is { id: string; npi: string } => r.npi !== null).map((r) => [r.npi, r.id]),
    );

    // ── Download + scan ─────────────────────────────────────────────────────
    await updateJobProgress(db, job.ingestionJobId, {
      message: `Downloading CMS archive (${keyToPlanId.size} target plans, ${npiToPharmacyId.size} known NPIs)`,
    });
    archive = await downloadToTemp(job.sourceUrl);

    const scan = await scanCmsZip(archive.zipPath, {
      targetKeys: new Set(keyToPlanId.keys()),
      knownNpis: new Set(npiToPharmacyId.keys()),
      onProgress: (message) => updateJobProgress(db, job.ingestionJobId, { message }),
    });
    if (!scan.networks.fileFound && !scan.costs.fileFound) {
      throw new Error(
        `No pharmacy-network or beneficiary-cost file recognized in the archive (entries: ${scan.entries.map((e) => e.name).join(", ")})`,
      );
    }

    // ── Pharmacy networks ───────────────────────────────────────────────────
    const planIds = [...new Set(keyToPlanId.values())];
    const networkCandidates: NetworkCandidate[] = [];
    for (const row of scan.networks.rows) {
      const planId = keyToPlanId.get(row.key);
      const pharmacyId = npiToPharmacyId.get(row.npi);
      if (!planId || !pharmacyId) continue;
      networkCandidates.push({
        planId,
        pharmacyId,
        status: row.preferredRetail ? "preferred" : "standard",
      });
    }
    const existingNetworks = await db
      .select({
        planId: planPharmacyNetworks.planId,
        pharmacyId: planPharmacyNetworks.pharmacyId,
        source: planPharmacyNetworks.source,
      })
      .from(planPharmacyNetworks)
      .where(inArray(planPharmacyNetworks.planId, planIds));
    const networkPlan = decideNetworkActions(networkCandidates, existingNetworks);

    await updateJobProgress(db, job.ingestionJobId, {
      message: `Upserting ${networkPlan.upserts.length} network rows (${networkPlan.preservedAgent} agent overrides preserved)`,
    });
    for (const upsert of networkPlan.upserts) {
      await db
        .insert(planPharmacyNetworks)
        .values({
          planId: upsert.planId,
          pharmacyId: upsert.pharmacyId,
          status: upsert.status,
          source: "cms",
        })
        .onConflictDoUpdate({
          target: [planPharmacyNetworks.planId, planPharmacyNetworks.pharmacyId],
          set: { status: upsert.status, source: "cms" },
          // Belt for races: never flip a row the agent has overridden.
          setWhere: sql`${planPharmacyNetworks.source} <> 'agent'`,
        });
    }

    // ── Beneficiary costs (prefill only) ────────────────────────────────────
    const costCandidates: CostCandidate[] = [];
    for (const row of scan.costs.rows) {
      const planId = keyToPlanId.get(row.key);
      if (!planId) continue;
      for (const channel of row.channels) {
        costCandidates.push({
          planId,
          channel: channel.channel,
          tier: row.tier,
          daysSupply: channel.daysSupply,
          copayCents: channel.copayCents,
          coinsurancePct: channel.coinsurancePct,
        });
      }
    }
    const existingCosts = await db
      .select({
        planId: planTierCosts.planId,
        channel: planTierCosts.channel,
        tier: planTierCosts.tier,
        daysSupply: planTierCosts.daysSupply,
      })
      .from(planTierCosts)
      .where(inArray(planTierCosts.planId, planIds));
    // planTierCosts.tier is already the "t<n>" enum string, matching costKey.
    const costDecision = decideCostInserts(
      costCandidates,
      new Set(
        existingCosts.map((r) => `${r.planId}|${r.channel}|${r.tier}|${r.daysSupply}`),
      ),
    );

    await updateJobProgress(db, job.ingestionJobId, {
      message: `Prefilling ${costDecision.inserts.length} tier-cost rows (${costDecision.skippedExisting} existing kept)`,
    });
    if (costDecision.inserts.length > 0) {
      await db
        .insert(planTierCosts)
        .values(
          costDecision.inserts.map((insert) => ({
            planId: insert.planId,
            channel: insert.channel,
            tier: tierFromNumber(insert.tier),
            daysSupply: insert.daysSupply,
            copayCents: insert.copayCents,
            coinsurancePct: insert.coinsurancePct,
            sourceNote: "CMS quarterly file",
          })),
        )
        .onConflictDoNothing();
    }

    await markJobDone(db, job.ingestionJobId, {
      message:
        `CMS import: ${networkPlan.upserts.length} network rows upserted ` +
        `(${networkPlan.preservedAgent} agent overrides preserved), ` +
        `${costDecision.inserts.length} cost rows prefilled (${costDecision.skippedExisting} existing kept), ` +
        `${keyToPlanId.size} plans matched, ${plansSkipped} plans skipped (no/invalid contractPlanId), ` +
        `lines scanned: ${scan.networks.linesScanned} network / ${scan.costs.linesScanned} cost, ` +
        `malformed rows: ${scan.networks.malformed} network / ${scan.costs.malformed} cost`,
    });
  } catch (error) {
    await markJobFailed(db, job.ingestionJobId, error);
    throw error;
  } finally {
    await archive?.cleanup().catch(() => undefined);
  }
}
