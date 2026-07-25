/**
 * Analysis rows (+ overrides) → ReportModel. Reads the PERSISTED
 * analysis_results — the report always reflects the grid the agent reviewed,
 * not a fresh engine run. All formatting delegates to ./display; overrides
 * are applied last so agent edits always win.
 */
import { and, eq, inArray } from "drizzle-orm";
import { analyses, getDb, planPharmacyNetworks, profiles } from "@rxsr/db";
import type { NetworkStatus } from "@rxsr/core";
import { findTierCost, resolveChannel, type EngineTierCost } from "@rxsr/core/analysis";
import {
  applyOverrides,
  type ReportGridRow,
  type ReportModel,
} from "@rxsr/core/report-model";
import {
  buildDeductibleFootnote,
  buildPlanBenefits,
  formatGridCellDisplay,
  formatMedicationName,
  pharmacyNote,
} from "./display";

const AGENCY_NAME = process.env.REPORT_AGENCY_NAME ?? "Rx Search & Rescue";

const DISCLAIMER =
  "This comparison is based on each plan's published formulary and Summary of Benefits " +
  "for the plan year shown. Cost sharing shown is the plan's tier copay or coinsurance, " +
  "not a pharmacy price. Confirm final costs with the carrier before enrolling.";

export async function buildReportModel(analysisId: string): Promise<ReportModel | null> {
  const db = getDb();
  const analysis = await db.query.analyses.findFirst({
    where: eq(analyses.id, analysisId),
    with: {
      client: {
        with: {
          pharmacies: { orderBy: (p, { asc }) => [asc(p.rank)], with: { pharmacy: true } },
        },
      },
      plans: {
        with: { plan: { with: { carrier: true, tierCosts: true } } },
        orderBy: (ap, { asc }) => [asc(ap.position)],
      },
      results: { with: { medication: true } },
      overrides: true,
      pricingPharmacy: true,
    },
  });
  if (!analysis) return null;

  const preparedById = analysis.assignedTo ?? analysis.approvedBy ?? analysis.createdBy;
  const preparedBy = preparedById
    ? ((await db.query.profiles.findFirst({ where: eq(profiles.id, preparedById) }))?.fullName ?? "")
    : "";

  // Plans: current plan renders as the first column.
  const orderedPlans = [...analysis.plans].sort((a, b) =>
    a.isCurrent === b.isCurrent ? a.position - b.position : a.isCurrent ? -1 : 1,
  );
  const currentPlanIndex = orderedPlans.findIndex((ap) => ap.isCurrent);

  // Pricing pharmacy: explicit choice, else the client's confirmed rank-1.
  const effectivePharmacy =
    analysis.pricingPharmacy ??
    analysis.client.pharmacies.find((p) => p.confirmed && p.pharmacy)?.pharmacy ??
    null;

  const statusByPlan = new Map<string, NetworkStatus>();
  if (effectivePharmacy && orderedPlans.length > 0) {
    const networkRows = await db
      .select({ planId: planPharmacyNetworks.planId, status: planPharmacyNetworks.status })
      .from(planPharmacyNetworks)
      .where(
        and(
          eq(planPharmacyNetworks.pharmacyId, effectivePharmacy.id),
          inArray(
            planPharmacyNetworks.planId,
            orderedPlans.map((ap) => ap.planId),
          ),
        ),
      );
    for (const row of networkRows) statusByPlan.set(row.planId, row.status);
  }

  const tierCostsByPlan = new Map<string, EngineTierCost[]>(
    orderedPlans.map((ap) => [
      ap.planId,
      ap.plan.tierCosts.map((tc) => ({
        channel: tc.channel,
        tier: tc.tier,
        daysSupply: tc.daysSupply,
        copayCents: tc.copayCents,
        coinsurancePct: tc.coinsurancePct == null ? null : Number(tc.coinsurancePct),
      })),
    ]),
  );

  // Grid from persisted results, medications in intake order.
  const resultByKey = new Map(
    analysis.results.map((r) => [`${r.medicationId}:${r.planId}`, r]),
  );
  const medications = [...new Map(analysis.results.map((r) => [r.medicationId, r.medication])).values()].sort(
    (a, b) => a.position - b.position,
  );

  const grid: ReportGridRow[] = medications.map((medication) => ({
    medicationName: formatMedicationName(medication.name, medication.prn),
    cells: orderedPlans.map((ap) => {
      const result = resultByKey.get(`${medication.id}:${ap.planId}`);
      if (!result) {
        return { display: "—", coverage: "not_on_formulary" as const, overridden: false };
      }
      const channel = resolveChannel(
        statusByPlan.get(ap.planId) ?? null,
        analysis.pricingChannelOverride,
      );
      const cost =
        channel && result.tier != null
          ? findTierCost(tierCostsByPlan.get(ap.planId) ?? [], result.tier, channel)
          : null;
      return {
        display: formatGridCellDisplay({
          coverage: result.coverage,
          tier: result.tier,
          copayCents: cost?.copayCents ?? null,
          coinsurancePct: cost?.coinsurancePct ?? null,
          substitutionNote: result.substitutionNote,
        }),
        coverage: result.coverage,
        overridden: false,
      };
    }),
  }));

  const includeMailOrder = analysis.pricingChannelOverride === "mail_order";
  const benefits = orderedPlans.map((ap) =>
    buildPlanBenefits({
      planName: ap.plan.name,
      carrierName: ap.plan.carrier.name,
      premiumCents: ap.plan.premiumCents,
      rxDeductibleCents: ap.plan.rxDeductibleCents,
      tierCosts: (tierCostsByPlan.get(ap.planId) ?? []).map((tc) => ({ ...tc })),
      includeMailOrder,
    }),
  );

  const pharmacyNotes = effectivePharmacy
    ? orderedPlans
        .map((ap) => {
          const status = statusByPlan.get(ap.planId);
          return status ? pharmacyNote(effectivePharmacy.name, ap.plan.name, status) : null;
        })
        .filter((note): note is string => note != null)
    : [];

  const model: ReportModel = {
    clientName: analysis.client.fullName,
    clientExternalId: analysis.client.externalId,
    planYear: analysis.planYear,
    preparedBy,
    agencyName: AGENCY_NAME,
    preparedDate: new Date().toISOString().slice(0, 10),
    pharmacyNotes,
    agentNotes: "",
    planNames: orderedPlans.map((ap) => ap.plan.name),
    currentPlanIndex: currentPlanIndex === -1 ? null : currentPlanIndex,
    grid,
    benefits,
    deductibleFootnote: buildDeductibleFootnote(
      orderedPlans.map((ap) => ({
        name: ap.plan.name,
        deductibleTiers: ap.plan.deductibleTiers,
      })),
    ),
    disclaimer: DISCLAIMER,
  };

  return applyOverrides(
    model,
    analysis.overrides.map((o) => ({ path: o.path, value: o.value })),
  );
}
