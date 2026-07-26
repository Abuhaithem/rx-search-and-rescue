/**
 * getComparison: fetch pre-ingested rows, run the PURE engine from
 * @rxsr/core/analysis, zip cells with medication metadata for the grid.
 * loadComparisonInputs is shared with actions/analysis.ts (runComparison
 * persists the same engine output it previews here).
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
  runAnalysis,
  type AnalysisOutput,
  type CellResult,
  type EngineFormularyEntry,
  type EngineMedication,
  type EnginePlan,
  type PlanSummary,
} from "@rxsr/core/analysis";
import type { AnalysisStatus, NetworkStatus, PharmacyChannel } from "@rxsr/core";

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
  /** Client pharmacy's network status on this plan; null = unknown. */
  pharmacyStatus: NetworkStatus | null;
}

/** Provenance for a matched formulary entry — powers the grid's popover receipts. */
export interface EntryProvenance {
  rawDrugName: string;
  sourcePage: number;
  rawRequirementsText: string | null;
  formularyLabel: string;
}

export interface ComparisonInputs {
  analysis: AnalysisRow;
  client: ClientRow;
  medications: MedicationRow[];
  planMeta: ComparisonPlanMeta[];
  engineMedications: EngineMedication[];
  enginePlans: EnginePlan[];
  pricingPharmacy: PharmacyRow | null;
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
        with: { plan: { with: { carrier: true, tierCosts: true } } },
        orderBy: (ap, { asc }) => [asc(ap.position)],
      },
      pricingPharmacy: true,
    },
  });
  if (!analysis) return null;

  const { client, plans: analysisPlanRows, pricingPharmacy, ...analysisColumns } = analysis;
  const { medications, pharmacies: clientPharmacyRows, ...clientColumns } = client;

  // Pricing context: explicit pricing pharmacy, else confirmed rank-1 pharmacy.
  const fallbackPharmacy =
    clientPharmacyRows.find((p) => p.confirmed && p.pharmacy)?.pharmacy ?? null;
  const effectivePharmacy = pricingPharmacy ?? fallbackPharmacy;

  const planIds = analysisPlanRows.map((ap) => ap.planId);
  const statusByPlan = new Map<string, NetworkStatus>();
  if (effectivePharmacy && planIds.length > 0) {
    const networkRows = await db
      .select({ planId: planPharmacyNetworks.planId, status: planPharmacyNetworks.status })
      .from(planPharmacyNetworks)
      .where(
        and(
          eq(planPharmacyNetworks.pharmacyId, effectivePharmacy.id),
          inArray(planPharmacyNetworks.planId, planIds),
        ),
      );
    for (const row of networkRows) statusByPlan.set(row.planId, row.status);
  }

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
      pharmacyStatus: statusByPlan.get(ap.planId) ?? null,
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
    clientPharmacyStatus: statusByPlan.get(ap.planId) ?? null,
  }));

  return {
    analysis: analysisColumns,
    client: clientColumns,
    medications,
    planMeta,
    engineMedications: medications.map(toEngineMedication),
    enginePlans,
    pricingPharmacy: effectivePharmacy,
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

export interface ComparisonData {
  analysis: {
    id: string;
    status: AnalysisStatus;
    planYear: number;
    pricingChannelOverride: PharmacyChannel | null;
  };
  client: ClientRow;
  plans: ComparisonPlanColumn[];
  grid: ComparisonGridRow[];
  pricingPharmacy: PharmacyRow | null;
  /** Channel override in effect; null = derived per plan from the pharmacy's network status. */
  channel: PharmacyChannel | null;
  /** Keyed by formulary entry id; lookup via CellResult.matchedEntryId. */
  entryProvenance: Record<string, EntryProvenance>;
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

export async function getComparison(
  analysisId: string,
  channelOverride?: PharmacyChannel,
): Promise<ComparisonData | null> {
  const inputs = await loadComparisonInputs(analysisId);
  if (!inputs) return null;

  const effectiveOverride = channelOverride ?? inputs.analysis.pricingChannelOverride ?? null;
  const output = runAnalysis(inputs.engineMedications, inputs.enginePlans, effectiveOverride);
  const { plans: planColumns, grid } = zipComparison(inputs, output);

  return {
    analysis: {
      id: inputs.analysis.id,
      status: inputs.analysis.status,
      planYear: inputs.analysis.planYear,
      pricingChannelOverride: inputs.analysis.pricingChannelOverride,
    },
    client: inputs.client,
    plans: planColumns,
    grid,
    pricingPharmacy: inputs.pricingPharmacy,
    channel: effectiveOverride,
    entryProvenance: inputs.entryProvenance,
  };
}
