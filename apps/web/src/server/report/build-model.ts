/**
 * Analysis rows (+ overrides) → ReportModel. Reads the PERSISTED
 * analysis_results — the report always reflects the grid the agent reviewed.
 * Cost is derived live from current tier costs (per the pure-engine rule):
 * the classic grid prices at the client's primary pharmacy, and the cost
 * matrix prices every compared pharmacy per plan. Formatting delegates to
 * ./display; overrides are applied last so agent edits always win.
 */
import { and, eq, inArray } from "drizzle-orm";
import { analyses, getDb, planPharmacyNetworks, profiles } from "@rxsr/db";
import { CHANNEL_LABELS, type Cents, type NetworkStatus } from "@rxsr/core";
import {
  findTierCost,
  mailChannelForPlan,
  priceScenarios,
  resolveChannel,
  type CellResult,
  type CostMatrixCell,
  type EngineMedication,
  type EnginePlan,
  type EngineTierCost,
} from "@rxsr/core/analysis";
import {
  applyOverrides,
  centsDisplay,
  type ReportCostMatrix,
  type ReportGridRow,
  type ReportModel,
} from "@rxsr/core/report-model";
import { resolvePricingScenarios } from "../queries/comparison";
import {
  buildDeductibleFootnote,
  buildPlanBenefits,
  formatGridCellDisplay,
  formatMedicationName,
  pharmacyNote,
} from "./display";

// Client-facing byline. "Rx Search & Rescue" is the internal program name and
// must not appear on the report; default to the agency, override via env.
const AGENCY_NAME = process.env.REPORT_AGENCY_NAME ?? "Insurance Specialists Group";

const DISCLAIMER =
  "This comparison is based on each plan's published formulary and Summary of Benefits " +
  "for the plan year shown. Cost sharing shown is the plan's tier copay or coinsurance, " +
  "not a pharmacy price. Confirm final costs with the carrier before enrolling.";

function formatMatrixCellDisplay(cell: CostMatrixCell): string {
  if (cell.unavailable) return "Out of Network";
  if (cell.hasCoinsurance) return "See coinsurance";
  if (cell.estMonthlyCents == null) return "—";
  const base = `${centsDisplay(cell.estMonthlyCents)}/mo`;
  return cell.isPartial ? `${base}*` : base;
}

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
      pharmacies: { orderBy: (ap, { asc }) => [asc(ap.position)], with: { pharmacy: true } },
      results: { with: { medication: true } },
      overrides: true,
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
  const orderedPlanIds = orderedPlans.map((ap) => ap.planId);
  const currentPlanIndex = orderedPlans.findIndex((ap) => ap.isCurrent);

  // Compared pharmacies: the analysis's explicit set, else client's confirmed.
  const explicit = analysis.pharmacies
    .map((ap) => ap.pharmacy)
    .filter((p): p is NonNullable<typeof p> => p != null);
  const fallback = analysis.client.pharmacies
    .filter((p) => p.confirmed && p.pharmacy)
    .map((p) => p.pharmacy)
    .filter((p): p is NonNullable<typeof p> => p != null);
  const comparedPharmacies = explicit.length > 0 ? explicit : fallback;
  const primaryPharmacy = comparedPharmacies[0] ?? null;

  // Network status for every compared pharmacy × plan.
  const statusByPharmacyPlan = new Map<string, NetworkStatus>();
  const pharmacyIds = comparedPharmacies.map((p) => p.id);
  if (pharmacyIds.length > 0 && orderedPlanIds.length > 0) {
    const networkRows = await db
      .select({
        pharmacyId: planPharmacyNetworks.pharmacyId,
        planId: planPharmacyNetworks.planId,
        status: planPharmacyNetworks.status,
      })
      .from(planPharmacyNetworks)
      .where(
        and(
          inArray(planPharmacyNetworks.pharmacyId, pharmacyIds),
          inArray(planPharmacyNetworks.planId, orderedPlanIds),
        ),
      );
    for (const row of networkRows) {
      statusByPharmacyPlan.set(`${row.pharmacyId}:${row.planId}`, row.status);
    }
  }
  const statusForPrimary = (planId: string): NetworkStatus | null =>
    primaryPharmacy ? (statusByPharmacyPlan.get(`${primaryPharmacy.id}:${planId}`) ?? null) : null;

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
  const medications = [
    ...new Map(analysis.results.map((r) => [r.medicationId, r.medication])).values(),
  ].sort((a, b) => a.position - b.position);

  const grid: ReportGridRow[] = medications.map((medication) => ({
    medicationName: formatMedicationName(medication.name, medication.prn),
    cells: orderedPlans.map((ap) => {
      const result = resultByKey.get(`${medication.id}:${ap.planId}`);
      if (!result) {
        return { display: "—", coverage: "not_on_formulary" as const, overridden: false };
      }
      const channel = resolveChannel(statusForPrimary(ap.planId), null);
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

  // Cost matrix: reuse the engine + the shared scenario resolver so the report
  // matches the on-screen matrix exactly.
  const engineMedications: EngineMedication[] = medications.map((m) => ({
    id: m.id,
    name: m.name,
    normalizedName: null,
    rxcuis: [],
    relatedRxcuis: [],
    genericOk: m.genericOk,
    prn: m.prn,
    quantity: m.quantity,
    daysSupply: m.daysSupply,
  }));
  const enginePlans: EnginePlan[] = orderedPlans.map((ap) => ({
    id: ap.planId,
    name: ap.plan.name,
    premiumCents: ap.plan.premiumCents,
    rxDeductibleCents: ap.plan.rxDeductibleCents,
    deductibleTiers: ap.plan.deductibleTiers,
    entries: [],
    tierCosts: tierCostsByPlan.get(ap.planId) ?? [],
    clientPharmacyStatus: statusForPrimary(ap.planId),
  }));
  const cells: CellResult[] = analysis.results.map((r) => ({
    medicationId: r.medicationId,
    planId: r.planId,
    coverage: r.coverage,
    matchMethod: r.matchMethod,
    matchedEntryId: r.matchedEntryId,
    substitutionNote: r.substitutionNote,
    tier: r.tier,
    restrictions: null,
    copayCents: null,
    coinsurancePct: null,
    needsConfirmation: r.needsConfirmation,
  }));

  const scenarios = resolvePricingScenarios({
    comparedPharmacies: comparedPharmacies.map((p) => ({ id: p.id, name: p.name })),
    orderedPlanIds,
    mailChannelByPlan: new Map(
      orderedPlanIds.map((id) => [id, mailChannelForPlan(tierCostsByPlan.get(id) ?? [])]),
    ),
    statusByPharmacyPlan,
    includeMailOrder: analysis.includeMailOrder,
  });

  const costMatrix = buildReportCostMatrix(
    scenarios,
    priceScenarios(cells, engineMedications, enginePlans, scenarios.map((s) => s.scenario)),
    orderedPlanIds,
  );

  const benefits = orderedPlans.map((ap) =>
    buildPlanBenefits({
      planName: ap.plan.name,
      carrierName: ap.plan.carrier.name,
      premiumCents: ap.plan.premiumCents,
      rxDeductibleCents: ap.plan.rxDeductibleCents,
      tierCosts: (tierCostsByPlan.get(ap.planId) ?? []).map((tc) => ({ ...tc })),
    }),
  );

  const pharmacyNotes = primaryPharmacy
    ? orderedPlans
        .map((ap) => {
          const status = statusForPrimary(ap.planId);
          return status ? pharmacyNote(primaryPharmacy.name, ap.plan.name, status) : null;
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
    costMatrix,
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

function buildReportCostMatrix(
  scenarios: { key: string; label: string }[],
  matrixCells: CostMatrixCell[],
  orderedPlanIds: string[],
): ReportCostMatrix | null {
  if (scenarios.length === 0) return null;
  const byKey = new Map(matrixCells.map((c) => [`${c.scenarioKey}:${c.planId}`, c]));

  let sawPartial = false;
  let sawCoinsurance = false;

  const rows = scenarios.map((scenario) => {
    let cheapestPlanId: string | null = null;
    let cheapestCents: Cents = Infinity;
    for (const planId of orderedPlanIds) {
      const cell = byKey.get(`${scenario.key}:${planId}`);
      if (cell?.estMonthlyCents != null && !cell.unavailable && cell.estMonthlyCents < cheapestCents) {
        cheapestCents = cell.estMonthlyCents;
        cheapestPlanId = planId;
      }
    }

    const cells = orderedPlanIds.map((planId) => {
      const cell = byKey.get(`${scenario.key}:${planId}`);
      if (cell?.isPartial) sawPartial = true;
      if (cell?.hasCoinsurance) sawCoinsurance = true;
      return {
        display: cell ? formatMatrixCellDisplay(cell) : "—",
        channelLabel: cell?.channel ? CHANNEL_LABELS[cell.channel] : "Out of Network",
        cheapest: planId === cheapestPlanId && cheapestPlanId != null,
        unavailable: cell?.unavailable ?? true,
      };
    });
    return { label: scenario.label, cells };
  });

  const notes: string[] = [];
  if (sawPartial) notes.push("* Estimate excludes drugs with no listed copay at that pharmacy.");
  if (sawCoinsurance)
    notes.push("Plans marked “See coinsurance” charge a percentage — the dollar total depends on the drug's price.");

  return { rows, note: notes.length > 0 ? notes.join(" ") : null };
}
