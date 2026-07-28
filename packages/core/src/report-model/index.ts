/**
 * The report model: the single serializable structure that both the on-screen
 * report preview and the .docx generator render from. Built by the backend
 * from analysis data + overrides; the renderers add NO logic of their own.
 */
import type { Cents, CostTier, PharmacyChannel } from "../types";

export interface ReportGridCell {
  /** Display string exactly as it should print, e.g. "$8 -T2", "T1", "Not Covered", "50% Cost of Medication". */
  display: string;
  coverage: "covered" | "covered_equivalent" | "not_covered" | "not_on_formulary";
  overridden: boolean;
}

export interface ReportGridRow {
  medicationName: string; // "Losartan", "Hydrocodone/Acet (prn)"
  cells: ReportGridCell[]; // aligned with plans[]
}

export interface ReportTierRow {
  label: string; // "T1" … "T6", "Covered Insulin"
  /** One value per channel column of this plan's benefit table. */
  values: string[]; // "$0", "$8.00", "100%", "50%"
}

export interface ReportPlanBenefits {
  planName: string;
  carrierName: string;
  premium: string; // "$0.00"
  rxDeductible: string; // "$340.00"
  /** Column headers, e.g. ["30 DAY In Network"] or ["30 DAY Standard", "30 Day Preferred"]. */
  channelHeaders: string[];
  channels: PharmacyChannel[];
  tierRows: ReportTierRow[];
}

/** One priced cell of the cost matrix — a pharmacy row × plan column. */
export interface ReportCostMatrixCell {
  /** Print-ready amount, e.g. "$48/mo", "See coinsurance", "Out of Network". */
  display: string;
  /** Channel this cell priced at, e.g. "Preferred Retail", "Standard Mail". */
  channelLabel: string;
  /** Cheapest plan for this pharmacy row — the "best for you" highlight. */
  cheapest: boolean;
  unavailable: boolean;
}

export interface ReportCostMatrixRow {
  /** Pharmacy name, or "Mail order (90-day)". */
  label: string;
  cells: ReportCostMatrixCell[]; // aligned with planNames
}

/**
 * Estimated monthly cost at each of the client's pharmacies, per plan — the
 * comparison centerpiece. Columns mirror the grid's plan columns.
 */
export interface ReportCostMatrix {
  rows: ReportCostMatrixRow[];
  note: string | null;
}

export interface ReportModel {
  clientName: string;
  clientExternalId: string | null;
  planYear: number;
  preparedBy: string;
  agencyName: string;
  preparedDate: string; // ISO date
  /** Auto-generated pharmacy note(s), e.g. "Valley Apothecary — Standard Pricing on the Pacific Source plan." */
  pharmacyNotes: string[];
  /** Free-text agent notes block (doctors, remarks). Editable, stored as override. */
  agentNotes: string;
  planNames: string[]; // grid column headers, current plan first
  currentPlanIndex: number | null;
  grid: ReportGridRow[];
  /** Estimated monthly cost per pharmacy × plan; null when no pharmacy is priced. */
  costMatrix: ReportCostMatrix | null;
  benefits: ReportPlanBenefits[];
  /** e.g. "RX Deductible applies to Tier 3, Tier 4 and Tier 5 medications on all plans." */
  deductibleFootnote: string | null;
  disclaimer: string | null;
}

export interface ReportOverrideEntry {
  path: string;
  value: unknown;
}

/** Apply stored overrides onto a freshly generated model (agent edits win). */
export function applyOverrides(model: ReportModel, overrides: ReportOverrideEntry[]): ReportModel {
  // ReportModel is serializable by contract — JSON round-trip is a safe deep clone.
  const out: ReportModel = JSON.parse(JSON.stringify(model)) as ReportModel;
  for (const { path, value } of overrides) {
    if (path === "agentNotes" && typeof value === "string") {
      out.agentNotes = value;
    } else if (path === "deductibleFootnote" && typeof value === "string") {
      out.deductibleFootnote = value;
    } else if (path.startsWith("grid.")) {
      // grid.<rowIndex>.<colIndex>.display
      const [, rowStr, colStr] = path.split(".");
      const row = out.grid[Number(rowStr)];
      const cell = row?.cells[Number(colStr)];
      if (cell && typeof value === "string") {
        cell.display = value;
        cell.overridden = true;
      }
    }
  }
  return out;
}

export const DEFAULT_DEDUCTIBLE_FOOTNOTE = (tiers: number[]): string | null =>
  tiers.length
    ? `RX Deductible applies to ${tiers
        .map((t) => `Tier ${t}`)
        .join(tiers.length > 2 ? ", " : " and ")
        .replace(/, (Tier \d+)$/, " and $1")} medications on all plans`
    : null;

export const centsDisplay = (cents: Cents): string =>
  `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;

export const TIER_LABELS: Record<CostTier, string> = {
  t1: "T1",
  t2: "T2",
  t3: "T3",
  t4: "T4",
  t5: "T5",
  t6: "T6",
  insulin: "Covered Insulin",
};
