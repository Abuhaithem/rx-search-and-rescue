import { and, eq, inArray } from "drizzle-orm";
import {
  clients,
  getDb,
  inForcePolicies,
  planPharmacyNetworks,
  plans,
  zipCounties,
} from "@rxsr/db";
import type { Cents, NetworkStatus, PharmacyChannel } from "@rxsr/core";

export type PlanRow = typeof plans.$inferSelect;

export type FormularyFreshness = "active" | "missing" | "stale";

export interface PlanCard {
  plan: PlanRow;
  carrierName: string;
  premiumCents: Cents | null;
  rxDeductibleCents: Cents | null;
  formularyStatus: FormularyFreshness;
  pharmacyStatus: NetworkStatus | null;
  tierCostsComplete: boolean;
  isCurrent: boolean;
}

const RETAIL_CHANNELS: PharmacyChannel[] = ["preferred_retail", "standard_retail"];
const REQUIRED_TIERS = ["t1", "t2", "t3", "t4", "t5"];

/** Complete = at least one retail channel priced across tiers 1–5 (T6/insulin optional). */
export function isTierCostsComplete(rows: { channel: PharmacyChannel; tier: string }[]): boolean {
  return RETAIL_CHANNELS.some((channel) => {
    const tiers = new Set(rows.filter((r) => r.channel === channel).map((r) => r.tier));
    return REQUIRED_TIERS.every((t) => tiers.has(t));
  });
}

export async function getAvailablePlans(clientId: string, planYear: number): Promise<PlanCard[]> {
  const db = getDb();

  const client = await db.query.clients.findFirst({
    where: eq(clients.id, clientId),
    with: {
      policies: true,
      pharmacies: { orderBy: (p, { asc }) => [asc(p.rank)] },
    },
  });
  if (!client) return [];

  // Service-area counties for the client: confirmed county, else ZIP crosswalk.
  let counties: { state: string; county: string }[] = [];
  if (client.state && client.county) {
    counties = [{ state: client.state, county: client.county }];
  } else if (client.zip) {
    counties = await db
      .select({ state: zipCounties.state, county: zipCounties.county })
      .from(zipCounties)
      .where(eq(zipCounties.zip, client.zip));
  }

  const planRows = await db.query.plans.findMany({
    where: and(eq(plans.planYear, planYear), eq(plans.curated, true)),
    with: { carrier: true, formulary: true, tierCosts: true, serviceAreas: true },
  });

  const inArea = planRows.filter((plan) => {
    if (plan.serviceAreas.length === 0 || counties.length === 0) return true; // incomplete data: don't hide
    return plan.serviceAreas.some((area) =>
      counties.some(
        (c) =>
          c.state.toLowerCase() === area.state.toLowerCase() &&
          c.county.toLowerCase() === area.county.toLowerCase(),
      ),
    );
  });

  // Client's confirmed rank-1 pharmacy → per-plan network status.
  const rankOnePharmacyId =
    client.pharmacies.find((p) => p.confirmed && p.pharmacyId)?.pharmacyId ?? null;
  const statusByPlan = new Map<string, NetworkStatus>();
  if (rankOnePharmacyId && inArea.length > 0) {
    const networkRows = await db
      .select({ planId: planPharmacyNetworks.planId, status: planPharmacyNetworks.status })
      .from(planPharmacyNetworks)
      .where(
        and(
          eq(planPharmacyNetworks.pharmacyId, rankOnePharmacyId),
          eq(planPharmacyNetworks.staged, false),
          inArray(
            planPharmacyNetworks.planId,
            inArea.map((p) => p.id),
          ),
        ),
      );
    for (const row of networkRows) statusByPlan.set(row.planId, row.status);
  }

  const currentPlanId =
    client.policies.find((p) => p.isCurrentDrugPlan && p.matchedPlanId)?.matchedPlanId ?? null;

  return inArea
    .map((plan) => {
      const { carrier, formulary, tierCosts, serviceAreas: _areas, ...planColumns } = plan;
      const formularyStatus: FormularyFreshness = !formulary
        ? "missing"
        : formulary.status === "active" && formulary.planYear === planYear
          ? "active"
          : "stale";
      return {
        plan: planColumns,
        carrierName: carrier.name,
        premiumCents: plan.premiumCents,
        rxDeductibleCents: plan.rxDeductibleCents,
        formularyStatus,
        pharmacyStatus: statusByPlan.get(plan.id) ?? null,
        tierCostsComplete: isTierCostsComplete(tierCosts),
        isCurrent: plan.id === currentPlanId,
      };
    })
    .sort((a, b) =>
      a.carrierName === b.carrierName
        ? a.plan.name.localeCompare(b.plan.name)
        : a.carrierName.localeCompare(b.carrierName),
    );
}

export interface CatalogTierCost {
  channel: PharmacyChannel;
  tier: string;
  daysSupply: number;
  copayCents: Cents | null;
  coinsurancePct: number | null;
  sourceNote: string | null;
}

export interface PlanCatalogRow {
  plan: PlanRow;
  carrierName: string;
  formularyLabel: string | null;
  formularyStatus: string | null;
  tierCostsComplete: boolean;
  tierCostCount: number;
  serviceAreaCount: number;
  /** Existing rows so the catalog editor prefills instead of starting blank. */
  tierCosts: CatalogTierCost[];
  serviceAreas: { state: string; county: string }[];
}

export async function getPlanCatalog(planYear: number): Promise<PlanCatalogRow[]> {
  const db = getDb();
  const rows = await db.query.plans.findMany({
    where: eq(plans.planYear, planYear),
    with: { carrier: true, formulary: true, tierCosts: true, serviceAreas: true },
    orderBy: (p, { asc }) => [asc(p.name)],
  });
  return rows.map((plan) => {
    const { carrier, formulary, tierCosts, serviceAreas, ...planColumns } = plan;
    return {
      plan: planColumns,
      carrierName: carrier.name,
      formularyLabel: formulary?.label ?? null,
      formularyStatus: formulary?.status ?? null,
      tierCostsComplete: isTierCostsComplete(tierCosts),
      tierCostCount: tierCosts.length,
      serviceAreaCount: serviceAreas.length,
      tierCosts: tierCosts.map((tc) => ({
        channel: tc.channel,
        tier: tc.tier,
        daysSupply: tc.daysSupply,
        copayCents: tc.copayCents,
        coinsurancePct: tc.coinsurancePct == null ? null : Number(tc.coinsurancePct),
        sourceNote: tc.sourceNote,
      })),
      serviceAreas: serviceAreas.map((a) => ({ state: a.state, county: a.county })),
    };
  });
}

/** Shared with actions/analysis.ts (selectPlans availability validation). */
export async function getCurrentDrugPlanId(clientId: string): Promise<string | null> {
  const db = getDb();
  const policy = await db.query.inForcePolicies.findFirst({
    where: and(eq(inForcePolicies.clientId, clientId), eq(inForcePolicies.isCurrentDrugPlan, true)),
  });
  return policy?.matchedPlanId ?? null;
}
