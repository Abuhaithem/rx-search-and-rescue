import { and, count, desc, eq, inArray, sql } from "drizzle-orm";
import {
  carrierPharmacyNetworks,
  formularies,
  formularyEntries,
  getDb,
  ingestionJobs,
  pharmacies,
  plans,
} from "@rxsr/db";
import type { NetworkStatus, PharmacyChannel } from "@rxsr/core";

export interface WizardJobStatus {
  kind: string;
  status: string;
  message: string | null;
  error: string | null;
}

export interface WizardStagedTierCost {
  channel: PharmacyChannel;
  tier: string;
  daysSupply: number;
  copayCents: number | null;
  coinsurancePct: number | null;
  maxCents: number | null;
}

export interface WizardPlan {
  id: string;
  name: string;
  sobPath: string | null;
  sobStaged: {
    premiumCents?: number | null;
    rxDeductibleCents?: number | null;
    deductibleTiers?: number[];
    tierLabels?: Record<string, string>;
  } | null;
  stagedTierCosts: WizardStagedTierCost[];
}

export interface WizardNetworkPreviewRow {
  pharmacyName: string;
  city: string | null;
  status: NetworkStatus;
}

export interface WizardState {
  formulary: {
    id: string;
    label: string;
    status: string;
    planYear: number;
    carrierId: string;
    carrierName: string;
    stats: (typeof formularies.$inferSelect)["stats"];
  };
  entrySample: {
    rawDrugName: string;
    tier: number;
    rawRequirementsText: string | null;
    sourcePage: number;
  }[];
  tierDistribution: { tier: number; count: number }[];
  needsReviewCount: number;
  plans: WizardPlan[];
  stagedNetwork: {
    total: number;
    byStatus: Record<NetworkStatus, number>;
    sample: WizardNetworkPreviewRow[];
  };
  jobs: WizardJobStatus[];
}

export async function getWizardState(formularyId: string): Promise<WizardState | null> {
  const db = getDb();
  const formulary = await db.query.formularies.findFirst({
    where: eq(formularies.id, formularyId),
    with: { carrier: true },
  });
  if (!formulary) return null;

  const [entrySample, tierDistribution, [reviewCount], wizardPlans, jobs] = await Promise.all([
    db
      .select({
        rawDrugName: formularyEntries.rawDrugName,
        tier: formularyEntries.tier,
        rawRequirementsText: formularyEntries.rawRequirementsText,
        sourcePage: formularyEntries.sourcePage,
      })
      .from(formularyEntries)
      .where(eq(formularyEntries.formularyId, formularyId))
      .orderBy(formularyEntries.sourcePage, formularyEntries.rawDrugName)
      .limit(12),
    db
      .select({ tier: formularyEntries.tier, count: count() })
      .from(formularyEntries)
      .where(eq(formularyEntries.formularyId, formularyId))
      .groupBy(formularyEntries.tier)
      .orderBy(formularyEntries.tier),
    db
      .select({ value: count() })
      .from(formularyEntries)
      .where(
        and(eq(formularyEntries.formularyId, formularyId), eq(formularyEntries.needsReview, true)),
      ),
    db.query.plans.findMany({
      where: eq(plans.formularyId, formularyId),
      orderBy: (p, { asc }) => [asc(p.name)],
      with: {
        tierCosts: { where: (t, { eq: eqOp }) => eqOp(t.staged, true) },
      },
    }),
    db
      .select({
        kind: ingestionJobs.kind,
        status: ingestionJobs.status,
        message: sql<string | null>`${ingestionJobs.progress} ->> 'message'`,
        error: ingestionJobs.error,
      })
      .from(ingestionJobs)
      .where(eq(ingestionJobs.targetId, formularyId))
      .orderBy(desc(ingestionJobs.createdAt))
      .limit(10),
  ]);

  let stagedTotal = 0;
  const byStatus: Record<NetworkStatus, number> = {
    preferred: 0,
    standard: 0,
    out_of_network: 0,
  };
  const statusRows = await db
    .select({ status: carrierPharmacyNetworks.status, count: count() })
    .from(carrierPharmacyNetworks)
    .where(
      and(
        eq(carrierPharmacyNetworks.carrierId, formulary.carrierId),
        eq(carrierPharmacyNetworks.staged, true),
      ),
    )
    .groupBy(carrierPharmacyNetworks.status);
  for (const row of statusRows) {
    byStatus[row.status] = row.count;
    stagedTotal += row.count;
  }
  const sample: WizardNetworkPreviewRow[] = await db
    .selectDistinct({
      pharmacyName: pharmacies.name,
      city: pharmacies.city,
      status: carrierPharmacyNetworks.status,
    })
    .from(carrierPharmacyNetworks)
    .innerJoin(pharmacies, eq(pharmacies.id, carrierPharmacyNetworks.pharmacyId))
    .where(
      and(
        eq(carrierPharmacyNetworks.carrierId, formulary.carrierId),
        eq(carrierPharmacyNetworks.staged, true),
      ),
    )
    .orderBy(pharmacies.name)
    .limit(15);

  return {
    formulary: {
      id: formulary.id,
      label: formulary.label,
      status: formulary.status,
      planYear: formulary.planYear,
      carrierId: formulary.carrierId,
      carrierName: formulary.carrier.name,
      stats: formulary.stats,
    },
    entrySample,
    tierDistribution,
    needsReviewCount: reviewCount?.value ?? 0,
    plans: wizardPlans.map((plan) => ({
      id: plan.id,
      name: plan.name,
      sobPath: plan.sobPath,
      sobStaged: plan.sobStaged,
      stagedTierCosts: plan.tierCosts.map((tc) => ({
        channel: tc.channel,
        tier: tc.tier,
        daysSupply: tc.daysSupply,
        copayCents: tc.copayCents,
        coinsurancePct: tc.coinsurancePct == null ? null : Number(tc.coinsurancePct),
        maxCents: tc.maxCents,
      })),
    })),
    stagedNetwork: { total: stagedTotal, byStatus, sample },
    jobs,
  };
}
