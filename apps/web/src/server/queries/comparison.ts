/**
 * getComparison: fetch pre-ingested rows, run the PURE engine from
 * @rxsr/core/analysis, zip cells with medication metadata for the grid, and
 * price every compared pharmacy into a plan × pharmacy cost matrix.
 * loadComparisonInputs is shared with actions/analysis.ts (runComparison
 * persists the same coverage cells it previews here).
 */
import { and, eq, inArray } from "drizzle-orm";
import {
  analyses,
  clientMedications,
  clients,
  formularyEntries,
  getDb,
  pharmacies,
  planPharmacyNetworks,
  plans,
} from "@rxsr/db";
import {
  mailChannelForPlan,
  priceScenarios,
  retailChannelForStatus,
  runAnalysis,
  type AnalysisOutput,
  type CellResult,
  type CostMatrixCell,
  type EngineFormularyEntry,
  type EngineMedication,
  type EnginePlan,
  type PlanSummary,
  type PricingScenario,
} from "@rxsr/core/analysis";
import {
  CHANNEL_LABELS,
  type AnalysisStatus,
  type Cents,
  type NetworkStatus,
  type PharmacyChannel,
} from "@rxsr/core";

export type AnalysisRow = typeof analyses.$inferSelect;
export type ClientRow = typeof clients.$inferSelect;
export type MedicationRow = typeof clientMedications.$inferSelect;
export type PharmacyRow = typeof pharmacies.$inferSelect;
export type PlanRow = typeof plans.$inferSelect;

export interface ComparisonPlanMeta {
  plan: PlanRow;
  carrierName: string;
  isCurrent: boolean;
  position: number;
  /** Primary pharmacy's network status on this plan; null = unknown. */
  pharmacyStatus: NetworkStatus | null;
}

/** Provenance for a matched formulary entry — powers the grid's popover receipts. */
export interface EntryProvenance {
  rawDrugName: string;
  sourcePage: number;
  rawRequirementsText: string | null;
  formularyLabel: string;
}

/** A pharmacy row of the cost matrix, plus which plans had no network row on file. */
export interface ComparisonScenario {
  key: string;
  label: string;
  kind: "retail" | "mail";
  pharmacyId: string | null;
  scenario: PricingScenario;
  /** Plan ids where the retail channel was assumed (no network status on file). */
  assumedPlanIds: Set<string>;
}

/** One compared pharmacy's network standing on every compared plan. */
export interface PharmacyNetworkRow {
  pharmacyId: string;
  pharmacyName: string;
  city: string | null;
  /** Keyed by planId; null = no network row on file (pricing assumes standard). */
  statusByPlan: Record<string, NetworkStatus | null>;
}

export interface ComparisonInputs {
  analysis: AnalysisRow;
  client: ClientRow;
  medications: MedicationRow[];
  planMeta: ComparisonPlanMeta[];
  engineMedications: EngineMedication[];
  enginePlans: EnginePlan[];
  /** Drives the classic per-cell grid pricing; the first compared pharmacy. */
  primaryPharmacy: PharmacyRow | null;
  pharmacyNetwork: PharmacyNetworkRow[];
  scenarios: ComparisonScenario[];
  /** Keyed by formulary entry id; lookup via CellResult.matchedEntryId. */
  entryProvenance: Record<string, EntryProvenance>;
}

const toEngineMedication = (med: MedicationRow): EngineMedication => ({
  id: med.id,
  name: med.name,
  normalizedName:
    [med.name, med.strength, med.form]
      .filter((part): part is string => Boolean(part))
      .join(" ")
      .toLowerCase() || null,
  rxcuis: med.rxcui ? [med.rxcui] : [],
  // Pipeline will fill brand/generic equivalents (med_related_rxcuis) later.
  relatedRxcuis: [],
  genericOk: med.genericOk,
  prn: med.prn,
  quantity: med.quantity,
  daysSupply: med.daysSupply,
});

export async function loadComparisonInputs(analysisId: string): Promise<ComparisonInputs | null> {
  const db = getDb();
  const analysis = await db.query.analyses.findFirst({
    where: eq(analyses.id, analysisId),
    with: {
      client: {
        with: {
          medications: { orderBy: (m, { asc }) => [asc(m.position)] },
          pharmacies: { orderBy: (p, { asc }) => [asc(p.rank)], with: { pharmacy: true } },
        },
      },
      plans: {
        with: {
          plan: {
            with: {
              carrier: true,
              tierCosts: { where: (t, { eq: eqOp }) => eqOp(t.staged, false) },
            },
          },
        },
        orderBy: (ap, { asc }) => [asc(ap.position)],
      },
      pharmacies: {
        orderBy: (ap, { asc }) => [asc(ap.position)],
        with: { pharmacy: true },
      },
    },
  });
  if (!analysis) return null;

  const {
    client,
    plans: analysisPlanRows,
    pharmacies: analysisPharmacyRows,
    ...analysisColumns
  } = analysis;
  const { medications, pharmacies: clientPharmacyRows, ...clientColumns } = client;

  // The pharmacies we price: the analysis's explicit set, else the client's
  // confirmed pharmacies as a fallback (older analyses / demo seed).
  const explicit = analysisPharmacyRows
    .map((ap) => ap.pharmacy)
    .filter((p): p is PharmacyRow => p != null);
  const fallback = clientPharmacyRows
    .filter((p) => p.confirmed && p.pharmacy)
    .map((p) => p.pharmacy)
    .filter((p): p is PharmacyRow => p != null);
  const comparedPharmacies = explicit.length > 0 ? explicit : fallback;
  const primaryPharmacy = comparedPharmacies[0] ?? null;

  const planIds = analysisPlanRows.map((ap) => ap.planId);

  // One query for every compared pharmacy × plan network status.
  const statusByPharmacyPlan = new Map<string, NetworkStatus>();
  const pharmacyIds = comparedPharmacies.map((p) => p.id);
  if (pharmacyIds.length > 0 && planIds.length > 0) {
    const networkRows = await db
      .select({
        pharmacyId: planPharmacyNetworks.pharmacyId,
        planId: planPharmacyNetworks.planId,
        status: planPharmacyNetworks.status,
      })
      .from(planPharmacyNetworks)
      .where(
        and(
          eq(planPharmacyNetworks.staged, false),
          inArray(planPharmacyNetworks.pharmacyId, pharmacyIds),
          inArray(planPharmacyNetworks.planId, planIds),
        ),
      );
    for (const row of networkRows) {
      statusByPharmacyPlan.set(`${row.pharmacyId}:${row.planId}`, row.status);
    }
  }

  const statusForPrimary = (planId: string): NetworkStatus | null =>
    primaryPharmacy ? (statusByPharmacyPlan.get(`${primaryPharmacy.id}:${planId}`) ?? null) : null;

  const formularyIds = [
    ...new Set(
      analysisPlanRows
        .map((ap) => ap.plan.formularyId)
        .filter((id): id is string => id != null),
    ),
  ];
  const entriesByFormulary = new Map<string, EngineFormularyEntry[]>();
  const entryProvenance: Record<string, EntryProvenance> = {};
  if (formularyIds.length > 0) {
    const formularyRows = await db.query.formularies.findMany({
      where: (f, { inArray: inArr }) => inArr(f.id, formularyIds),
      columns: { id: true, label: true },
    });
    const formularyLabels = new Map(formularyRows.map((f) => [f.id, f.label]));

    const entryRows = await db
      .select({
        id: formularyEntries.id,
        formularyId: formularyEntries.formularyId,
        rawDrugName: formularyEntries.rawDrugName,
        normalizedName: formularyEntries.normalizedName,
        rxcuis: formularyEntries.rxcuis,
        isBrand: formularyEntries.isBrand,
        tier: formularyEntries.tier,
        pa: formularyEntries.pa,
        st: formularyEntries.st,
        qlQuantity: formularyEntries.qlQuantity,
        qlDays: formularyEntries.qlDays,
        extraFlags: formularyEntries.extraFlags,
        sourcePage: formularyEntries.sourcePage,
        rawRequirementsText: formularyEntries.rawRequirementsText,
      })
      .from(formularyEntries)
      .where(inArray(formularyEntries.formularyId, formularyIds));
    for (const { formularyId, sourcePage, rawRequirementsText, ...entry } of entryRows) {
      const list = entriesByFormulary.get(formularyId) ?? [];
      list.push(entry);
      entriesByFormulary.set(formularyId, list);
      entryProvenance[entry.id] = {
        rawDrugName: entry.rawDrugName,
        sourcePage,
        rawRequirementsText,
        formularyLabel: formularyLabels.get(formularyId) ?? "formulary",
      };
    }
  }

  // Current plan renders first, then agent-chosen order.
  const orderedPlanRows = [...analysisPlanRows].sort((a, b) =>
    a.isCurrent === b.isCurrent ? a.position - b.position : a.isCurrent ? -1 : 1,
  );

  const planMeta: ComparisonPlanMeta[] = orderedPlanRows.map((ap) => {
    const { carrier, tierCosts: _tc, ...planColumns } = ap.plan;
    return {
      plan: planColumns,
      carrierName: carrier.name,
      isCurrent: ap.isCurrent,
      position: ap.position,
      pharmacyStatus: statusForPrimary(ap.planId),
    };
  });

  const enginePlans: EnginePlan[] = orderedPlanRows.map((ap) => ({
    id: ap.plan.id,
    name: ap.plan.name,
    premiumCents: ap.plan.premiumCents,
    rxDeductibleCents: ap.plan.rxDeductibleCents,
    deductibleTiers: ap.plan.deductibleTiers,
    entries: ap.plan.formularyId ? (entriesByFormulary.get(ap.plan.formularyId) ?? []) : [],
    tierCosts: ap.plan.tierCosts.map((tc) => ({
      channel: tc.channel,
      tier: tc.tier,
      daysSupply: tc.daysSupply,
      copayCents: tc.copayCents,
      coinsurancePct: tc.coinsurancePct == null ? null : Number(tc.coinsurancePct),
    })),
    clientPharmacyStatus: statusForPrimary(ap.plan.id),
  }));
  const orderedPlanIds = orderedPlanRows.map((ap) => ap.plan.id);
  const mailChannelByPlan = new Map(
    enginePlans.map((p) => [p.id, mailChannelForPlan(p.tierCosts)]),
  );
  const scenarios = resolvePricingScenarios({
    comparedPharmacies,
    orderedPlanIds,
    mailChannelByPlan,
    statusByPharmacyPlan,
    includeMailOrder: analysis.includeMailOrder,
  });

  const pharmacyNetwork: PharmacyNetworkRow[] = comparedPharmacies.map((pharmacy) => ({
    pharmacyId: pharmacy.id,
    pharmacyName: pharmacy.name,
    city: pharmacy.city,
    statusByPlan: Object.fromEntries(
      orderedPlanRows.map((ap) => [
        ap.plan.id,
        statusByPharmacyPlan.get(`${pharmacy.id}:${ap.plan.id}`) ?? null,
      ]),
    ),
  }));

  return {
    analysis: analysisColumns as AnalysisRow,
    client: clientColumns as ClientRow,
    medications,
    planMeta,
    engineMedications: medications.map(toEngineMedication),
    enginePlans,
    primaryPharmacy,
    pharmacyNetwork,
    scenarios,
    entryProvenance,
  };
}

export interface ComparisonGridRow {
  medication: MedicationRow;
  /** Aligned with `plans` (current plan first). */
  cells: CellResult[];
}

export interface ComparisonPlanColumn extends ComparisonPlanMeta {
  summary: PlanSummary;
}

/** One priced cell of the cost matrix, ready for the UI. */
export interface ComparisonMatrixCell {
  planId: string;
  channel: PharmacyChannel | null;
  channelLabel: string;
  estMonthlyCents: Cents | null;
  unavailable: boolean;
  isPartial: boolean;
  hasCoinsurance: boolean;
  /** Retail channel was assumed (no network row on file) — surface amber. */
  assumed: boolean;
  /** Cheapest priced plan for this pharmacy row — the "best for you" highlight. */
  cheapest: boolean;
}

export interface ComparisonMatrixRow {
  key: string;
  label: string;
  kind: "retail" | "mail";
  cells: ComparisonMatrixCell[];
}

export interface ComparisonData {
  analysis: {
    id: string;
    status: AnalysisStatus;
    planYear: number;
    includeMailOrder: boolean;
  };
  client: ClientRow;
  plans: ComparisonPlanColumn[];
  grid: ComparisonGridRow[];
  primaryPharmacy: PharmacyRow | null;
  pharmacyNetwork: PharmacyNetworkRow[];
  costMatrix: ComparisonMatrixRow[];
  /** Keyed by formulary entry id; lookup via CellResult.matchedEntryId. */
  entryProvenance: Record<string, EntryProvenance>;
}

const channelLabel = (channel: PharmacyChannel | null): string =>
  channel ? CHANNEL_LABELS[channel] : "Out of Network";

/**
 * Build the cost-matrix scenarios: one retail row per compared pharmacy (its
 * channel resolved per plan from network status), plus a mail row when opted
 * in. Pure — shared by the on-screen comparison and the report builder.
 */
export function resolvePricingScenarios(args: {
  comparedPharmacies: { id: string; name: string }[];
  orderedPlanIds: string[];
  mailChannelByPlan: Map<string, PharmacyChannel | null>;
  statusByPharmacyPlan: Map<string, NetworkStatus>;
  includeMailOrder: boolean;
}): ComparisonScenario[] {
  const scenarios: ComparisonScenario[] = args.comparedPharmacies.map((pharmacy) => {
    const channelByPlan: Record<string, PharmacyChannel | null> = {};
    const assumedPlanIds = new Set<string>();
    for (const planId of args.orderedPlanIds) {
      const status = args.statusByPharmacyPlan.get(`${pharmacy.id}:${planId}`) ?? null;
      channelByPlan[planId] = retailChannelForStatus(status);
      if (status == null) assumedPlanIds.add(planId);
    }
    return {
      key: pharmacy.id,
      label: pharmacy.name,
      kind: "retail",
      pharmacyId: pharmacy.id,
      scenario: { key: pharmacy.id, label: pharmacy.name, kind: "retail", channelByPlan },
      assumedPlanIds,
    };
  });

  if (args.includeMailOrder) {
    const channelByPlan: Record<string, PharmacyChannel | null> = {};
    for (const planId of args.orderedPlanIds) {
      channelByPlan[planId] = args.mailChannelByPlan.get(planId) ?? null;
    }
    scenarios.push({
      key: "mail",
      label: "Mail order (90-day)",
      kind: "mail",
      pharmacyId: null,
      scenario: { key: "mail", label: "Mail order (90-day)", kind: "mail", channelByPlan },
      assumedPlanIds: new Set(),
    });
  }

  return scenarios;
}

export function zipComparison(
  inputs: ComparisonInputs,
  output: AnalysisOutput,
): Pick<ComparisonData, "plans" | "grid"> {
  const cellByKey = new Map<string, CellResult>();
  for (const cell of output.cells) cellByKey.set(`${cell.medicationId}:${cell.planId}`, cell);
  const summaryByPlan = new Map(output.summaries.map((s) => [s.planId, s]));

  const grid: ComparisonGridRow[] = inputs.medications.map((medication) => ({
    medication,
    cells: inputs.planMeta.map((meta) => {
      const cell = cellByKey.get(`${medication.id}:${meta.plan.id}`);
      if (!cell) throw new Error("engine output missing a medication × plan cell");
      return cell;
    }),
  }));

  const plans: ComparisonPlanColumn[] = inputs.planMeta.map((meta) => {
    const summary = summaryByPlan.get(meta.plan.id);
    if (!summary) throw new Error("engine output missing a plan summary");
    return { ...meta, summary };
  });

  return { plans, grid };
}

function buildCostMatrix(
  inputs: ComparisonInputs,
  matrixCells: CostMatrixCell[],
): ComparisonMatrixRow[] {
  const byKey = new Map(matrixCells.map((c) => [`${c.scenarioKey}:${c.planId}`, c]));
  const planOrder = inputs.planMeta.map((m) => m.plan.id);

  return inputs.scenarios.map((scenario) => {
    // Cheapest priced plan in this row (per pharmacy across plans).
    let cheapestPlanId: string | null = null;
    let cheapest = Infinity;
    for (const planId of planOrder) {
      const cell = byKey.get(`${scenario.key}:${planId}`);
      if (cell && !cell.unavailable && cell.estMonthlyCents != null && cell.estMonthlyCents < cheapest) {
        cheapest = cell.estMonthlyCents;
        cheapestPlanId = planId;
      }
    }

    const cells: ComparisonMatrixCell[] = planOrder.map((planId) => {
      const cell = byKey.get(`${scenario.key}:${planId}`);
      return {
        planId,
        channel: cell?.channel ?? null,
        channelLabel: channelLabel(cell?.channel ?? null),
        estMonthlyCents: cell?.estMonthlyCents ?? null,
        unavailable: cell?.unavailable ?? true,
        isPartial: cell?.isPartial ?? false,
        hasCoinsurance: cell?.hasCoinsurance ?? false,
        assumed: scenario.assumedPlanIds.has(planId),
        cheapest: planId === cheapestPlanId && cheapestPlanId != null,
      };
    });

    return { key: scenario.key, label: scenario.label, kind: scenario.kind, cells };
  });
}

export interface PharmacyOption {
  id: string;
  name: string;
  city: string | null;
  state: string | null;
}

export interface ComparablePharmacies {
  options: PharmacyOption[];
  selectedIds: string[];
  locked: boolean;
}

/**
 * The pharmacy-picker's data: the directory (scoped to the client's state) plus
 * which pharmacies are currently on the analysis. selectedIds reflects the
 * explicit analysis_pharmacies rows only — not the confirmed-pharmacy fallback.
 */
export async function getComparablePharmacies(
  analysisId: string,
): Promise<ComparablePharmacies | null> {
  const db = getDb();
  const analysis = await db.query.analyses.findFirst({
    where: eq(analyses.id, analysisId),
    columns: { status: true },
    with: {
      client: { columns: { state: true } },
      pharmacies: { columns: { pharmacyId: true } },
    },
  });
  if (!analysis) return null;

  const state = analysis.client.state;
  const options = await db.query.pharmacies.findMany({
    where: state ? eq(pharmacies.state, state) : undefined,
    columns: { id: true, name: true, city: true, state: true },
    orderBy: (p, { asc }) => [asc(p.name)],
  });

  return {
    options,
    selectedIds: analysis.pharmacies.map((p) => p.pharmacyId),
    locked: analysis.status === "approved" || analysis.status === "delivered",
  };
}

export async function getComparison(analysisId: string): Promise<ComparisonData | null> {
  const inputs = await loadComparisonInputs(analysisId);
  if (!inputs) return null;

  const output = runAnalysis(inputs.engineMedications, inputs.enginePlans);
  const matrixCells = priceScenarios(
    output.cells,
    inputs.engineMedications,
    inputs.enginePlans,
    inputs.scenarios.map((s) => s.scenario),
  );
  const { plans: planColumns, grid } = zipComparison(inputs, output);

  return {
    analysis: {
      id: inputs.analysis.id,
      status: inputs.analysis.status,
      planYear: inputs.analysis.planYear,
      includeMailOrder: inputs.analysis.includeMailOrder,
    },
    client: inputs.client,
    plans: planColumns,
    grid,
    primaryPharmacy: inputs.primaryPharmacy,
    pharmacyNetwork: inputs.pharmacyNetwork,
    costMatrix: buildCostMatrix(inputs, matrixCells),
    entryProvenance: inputs.entryProvenance,
  };
}
