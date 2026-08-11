/**
 * Carrier workbook import (.xlsx): deterministic ingestion of the agency's
 * "Part D Drug Price Lookup" template. Tier Pricing by Plan → plan_tier_costs
 * (+ tier display labels + Rx deductible when the plan has none yet);
 * Pharmacy Network chain rules → the carrier's single network
 * (carrier_pharmacy_networks) over existing pharmacies rows. No LLM anywhere. Precedence mirrors the CMS import:
 * existing tier costs are never overwritten, agent network rows always win.
 */
import {
  and,
  carrierPharmacyNetworks,
  eq,
  ilike,
  pharmacies,
  plans,
  planTierCosts,
  sql,
} from "@rxsr/db";
import type { XlsxImportJob } from "../queues";
import { markJobDone, markJobFailed, markJobRunning, updateJobProgress } from "../lib/db";
import { parseCarrierWorkbook, readWorkbook, type TierPricingRow } from "../lib/workbook";
import { createJobDeps, type JobDeps } from "./deps";

type CostTier = "t1" | "t2" | "t3" | "t4" | "t5" | "t6" | "insulin";
const SOURCE_NOTE = "carrier workbook import";

export async function runXlsxImport(
  job: XlsxImportJob,
  deps: JobDeps = createJobDeps(),
): Promise<void> {
  const { db } = deps;
  await markJobRunning(db, job.ingestionJobId);
  try {
    await updateJobProgress(db, job.ingestionJobId, { message: "Reading workbook" });
    const bytes = await deps.storage.download(job.storagePath);
    const parsed = parseCarrierWorkbook(readWorkbook(bytes));
    const warnings = [...parsed.warnings];

    const carrierPlans = await db
      .select()
      .from(plans)
      .where(and(eq(plans.carrierId, job.carrierId), eq(plans.planYear, job.planYear)));
    const planByName = new Map(carrierPlans.map((p) => [p.name.trim().toLowerCase(), p]));

    // ── Tier pricing ────────────────────────────────────────────────────────
    const byPlan = new Map<string, TierPricingRow[]>();
    for (const row of parsed.tierPricing) {
      const list = byPlan.get(row.planName) ?? [];
      list.push(row);
      byPlan.set(row.planName, list);
    }

    let plansPriced = 0;
    let plansSkipped = 0;
    const matchedPlanIds: string[] = [];
    for (const [planName, rows] of byPlan) {
      const plan = planByName.get(planName.trim().toLowerCase());
      if (!plan) {
        warnings.push(`No plan named "${planName}" for ${job.planYear} — create it first`);
        continue;
      }
      matchedPlanIds.push(plan.id);

      const existing = await db
        .select({ id: planTierCosts.id })
        .from(planTierCosts)
        .where(eq(planTierCosts.planId, plan.id))
        .limit(1);
      if (existing.length > 0) {
        plansSkipped += 1; // agent-entered costs outrank the workbook
      } else {
        const inserts: (typeof planTierCosts.$inferInsert)[] = [];
        const insulinCapByChannel = new Map<string, number>();
        for (const row of rows) {
          for (const [channel, cost] of Object.entries(row.costs)) {
            if (!cost.covered) continue;
            inserts.push({
              planId: plan.id,
              channel: channel as (typeof planTierCosts.$inferInsert)["channel"],
              tier: `t${row.tier}` as CostTier,
              daysSupply: row.daysSupply,
              copayCents: cost.copayCents,
              coinsurancePct: cost.coinsurancePct === null ? null : String(cost.coinsurancePct),
              sourceNote: SOURCE_NOTE,
            });
            if (cost.insulinCapCents !== null && !insulinCapByChannel.has(channel)) {
              insulinCapByChannel.set(channel, cost.insulinCapCents);
            }
          }
        }
        for (const [channel, capCents] of insulinCapByChannel) {
          inserts.push({
            planId: plan.id,
            channel: channel as (typeof planTierCosts.$inferInsert)["channel"],
            tier: "insulin",
            daysSupply: 30,
            copayCents: capCents,
            coinsurancePct: null,
            sourceNote: SOURCE_NOTE,
          });
        }
        if (inserts.length > 0) {
          await db.insert(planTierCosts).values(inserts);
          plansPriced += 1;
        }
      }

      // Display labels + deductible fill in only where nothing is set yet.
      const labelPatch: Record<string, string> = {};
      for (const row of rows) {
        const key = `t${row.tier}`;
        if (row.tierLabel && !(plan.tierLabels ?? {})[key as "t1"]) {
          labelPatch[key] = row.tierLabel;
        }
      }
      const deductibleCents =
        rows.map((r) => r.deductibleCents).find((c): c is number => c !== null) ?? null;
      const deductibleTiers = rows.filter((r) => r.deductibleApplies).map((r) => r.tier);
      const patch: Partial<typeof plans.$inferInsert> = {};
      if (Object.keys(labelPatch).length > 0) {
        patch.tierLabels = { ...(plan.tierLabels ?? {}), ...labelPatch };
      }
      if (plan.rxDeductibleCents === null && deductibleCents !== null) {
        patch.rxDeductibleCents = deductibleCents;
      }
      if (plan.deductibleTiers.length === 0 && deductibleTiers.length > 0) {
        patch.deductibleTiers = deductibleTiers;
      }
      if (Object.keys(patch).length > 0) {
        await db.update(plans).set(patch).where(eq(plans.id, plan.id));
      }
    }

    // ── Pharmacy network chain rules ────────────────────────────────────────
    await updateJobProgress(db, job.ingestionJobId, {
      message: `Applying ${parsed.networkRules.length} pharmacy network rules`,
    });
    const claimed = new Set<string>();
    let networkLinks = 0;
    for (const rule of parsed.networkRules) {
      // Any of the rule's names matches ("Sav-On" or "Albertsons"), and every
      // matched row learns the other names as altNames — so an RxC form
      // writing either name resolves to the same pharmacy record.
      const seen = new Map<string, { id: string; name: string; altNames: string[] }>();
      for (const pattern of rule.patterns) {
        const matches = await db
          .select({ id: pharmacies.id, name: pharmacies.name, altNames: pharmacies.altNames })
          .from(pharmacies)
          .where(ilike(pharmacies.name, `%${pattern}%`));
        for (const match of matches) seen.set(match.id, match);
      }
      for (const pharmacy of seen.values()) {
        if (claimed.has(pharmacy.id)) continue; // longer/earlier rule already decided
        claimed.add(pharmacy.id);

        const lowerName = pharmacy.name.toLowerCase();
        const aliases = rule.patterns.filter(
          (p) =>
            !lowerName.includes(p.toLowerCase()) &&
            !pharmacy.altNames.some((a) => a.toLowerCase() === p.toLowerCase()),
        );
        if (aliases.length > 0) {
          await db
            .update(pharmacies)
            .set({ altNames: [...pharmacy.altNames, ...aliases] })
            .where(eq(pharmacies.id, pharmacy.id));
        }
        await db
          .insert(carrierPharmacyNetworks)
          .values({
            carrierId: job.carrierId,
            pharmacyId: pharmacy.id,
            status: rule.status,
            source: "xlsx",
          })
          .onConflictDoUpdate({
            target: [carrierPharmacyNetworks.carrierId, carrierPharmacyNetworks.pharmacyId],
            set: { status: rule.status, source: "xlsx" },
            setWhere: sql`${carrierPharmacyNetworks.source} <> 'agent'`,
          });
        networkLinks += 1;
      }
    }

    await markJobDone(db, job.ingestionJobId, {
      message: [
        `Priced ${plansPriced} plans`,
        plansSkipped > 0 ? `${plansSkipped} kept existing costs` : null,
        `${networkLinks} pharmacy network links`,
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
