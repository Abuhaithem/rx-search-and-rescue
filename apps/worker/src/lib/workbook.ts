/**
 * Deterministic parsing of agency carrier workbooks (.xlsx). The workbook
 * layout is the in-house "Part D Drug Price Lookup" template: a "Tier Pricing
 * by Plan" tab (Summary-of-Benefits cost sharing, the engine's input) and a
 * "Pharmacy Network" tab (chain-level preferred/standard/out-of-network
 * rules). Sheets are found by name first, then by header shape — extra or
 * reordered tabs are fine. The "Drug Price Lookup" tab is a derived view of
 * formulary + tier data and is intentionally not ingested.
 *
 * No AI anywhere in this path: workbooks are structured data.
 */
import * as XLSX from "xlsx";
import type { NetworkStatus, PharmacyChannel } from "@rxsr/core";

export type SheetRows = unknown[][];

export interface WorkbookSheets {
  names: string[];
  rows(name: string): SheetRows;
}

export function readWorkbook(bytes: Uint8Array): WorkbookSheets {
  const workbook = XLSX.read(bytes, { type: "buffer" });
  return {
    names: workbook.SheetNames,
    rows(name) {
      const sheet = workbook.Sheets[name];
      if (!sheet) throw new Error(`Workbook has no sheet named "${name}"`);
      return XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, blankrows: false });
    },
  };
}

const cellText = (cell: unknown): string =>
  cell == null ? "" : String(cell).replace(/\s+/g, " ").trim();

// ─── Money / cost-sharing cells ──────────────────────────────────────────────

export interface ParsedCostCell {
  copayCents: number | null;
  coinsurancePct: number | null;
  /** Parenthetical insulin cap, e.g. "$40 ($35 insulin)" → 3500. */
  insulinCapCents: number | null;
  covered: boolean;
}

/** "$0" | "$6" | "$40 ($35 insulin)" | "25% of cost" | "Not covered". */
export function parseCostCell(raw: unknown): ParsedCostCell | null {
  const text = cellText(raw);
  if (text === "") return null;
  if (/not\s+covered/i.test(text)) {
    return { copayCents: null, coinsurancePct: null, insulinCapCents: null, covered: false };
  }

  const insulin = text.match(/\(\s*\$(\d+(?:\.\d{1,2})?)\s*insulin\s*\)/i);
  const insulinCapCents = insulin ? Math.round(Number(insulin[1]) * 100) : null;
  const main = text.replace(/\([^)]*\)/g, "").trim();

  const pct = main.match(/(\d+(?:\.\d+)?)\s*%/);
  if (pct) {
    return { copayCents: null, coinsurancePct: Number(pct[1]), insulinCapCents, covered: true };
  }
  const dollars = main.match(/\$\s*(\d+(?:\.\d{1,2})?)/);
  if (dollars) {
    return {
      copayCents: Math.round(Number(dollars[1]) * 100),
      coinsurancePct: null,
      insulinCapCents,
      covered: true,
    };
  }
  return null;
}

/** "Up to 30-day supply" → 30. Null when unparseable. */
export function parseDaysSupply(raw: unknown): number | null {
  const match = cellText(raw).match(/(\d+)\s*-?\s*day/i);
  return match ? Number(match[1]) : null;
}

/** "Yes — $175 first" → { applies: true, deductibleCents: 17500 }. */
export function parseDeductibleCell(raw: unknown): {
  applies: boolean;
  deductibleCents: number | null;
} {
  const text = cellText(raw);
  const applies = /^yes/i.test(text);
  const amount = text.match(/\$\s*(\d+(?:\.\d{1,2})?)/);
  return { applies, deductibleCents: applies && amount ? Math.round(Number(amount[1]) * 100) : null };
}

// ─── Tier Pricing by Plan ────────────────────────────────────────────────────

export interface TierPricingRow {
  planName: string;
  tier: number;
  /** Display label with the "Tier N —" prefix stripped, e.g. "Preferred Generic". */
  tierLabel: string | null;
  daysSupply: number;
  deductibleApplies: boolean;
  deductibleCents: number | null;
  costs: Partial<Record<PharmacyChannel, ParsedCostCell>>;
}

interface HeaderMap {
  rowIndex: number;
  columns: Map<string, number>;
}

function findHeader(rows: SheetRows, requiredPatterns: RegExp[]): HeaderMap | null {
  for (const [rowIndex, row] of rows.entries()) {
    const columns = new Map<string, number>();
    for (const [colIndex, cell] of row.entries()) {
      const text = cellText(cell).toLowerCase();
      if (text !== "") columns.set(text, colIndex);
    }
    const findCol = (pattern: RegExp): number | undefined => {
      for (const [text, index] of columns) if (pattern.test(text)) return index;
      return undefined;
    };
    if (requiredPatterns.every((p) => findCol(p) !== undefined)) {
      return { rowIndex, columns };
    }
  }
  return null;
}

const colOf = (header: HeaderMap, pattern: RegExp): number | null => {
  for (const [text, index] of header.columns) if (pattern.test(text)) return index;
  return null;
};

export function parseTierPricingSheet(rows: SheetRows): TierPricingRow[] {
  const header = findHeader(rows, [/^plan$/, /^tier$/, /preferred retail/]);
  if (!header) return [];

  const planCol = colOf(header, /^plan$/)!;
  const tierCol = colOf(header, /^tier$/)!;
  const tierNameCol = colOf(header, /tier name/);
  const preferredCol = colOf(header, /preferred retail/)!;
  const standardCol = colOf(header, /standard retail/);
  const mailCol = colOf(header, /mail/);
  const supplyCol = colOf(header, /supply/);
  const deductibleCol = colOf(header, /deductible/);

  const parsed: TierPricingRow[] = [];
  for (const row of rows.slice(header.rowIndex + 1)) {
    const planName = cellText(row[planCol]);
    const tier = Number(cellText(row[tierCol]));
    if (planName === "" || !Number.isInteger(tier) || tier < 1 || tier > 6) continue;

    const costs: TierPricingRow["costs"] = {};
    const preferred = parseCostCell(row[preferredCol]);
    if (preferred) costs.preferred_retail = preferred;
    if (standardCol !== null) {
      const standard = parseCostCell(row[standardCol]);
      if (standard) costs.standard_retail = standard;
    }
    if (mailCol !== null) {
      const mail = parseCostCell(row[mailCol]);
      // Mail order is formally standard cost sharing in these workbooks.
      if (mail) costs.standard_mail = mail;
    }

    const deductible = deductibleCol === null
      ? { applies: false, deductibleCents: null }
      : parseDeductibleCell(row[deductibleCol]);

    const rawTierName = tierNameCol === null ? "" : cellText(row[tierNameCol]);
    parsed.push({
      planName,
      tier,
      tierLabel: rawTierName === "" ? null : rawTierName.replace(/^tier\s*\d+\s*[—–-]\s*/i, ""),
      daysSupply: (supplyCol !== null ? parseDaysSupply(row[supplyCol]) : null) ?? 30,
      deductibleApplies: deductible.applies,
      deductibleCents: deductible.deductibleCents,
      costs,
    });
  }
  return parsed;
}

// ─── Pharmacy Network ────────────────────────────────────────────────────────

export interface PharmacyNetworkRule {
  /** As printed, e.g. "Sav-On Pharmacy (inside Albertsons)". */
  label: string;
  /** Core name used for ILIKE matching, e.g. "Sav-On". */
  pattern: string;
  status: NetworkStatus;
  note: string | null;
}

export function parseNetworkStatus(raw: unknown): NetworkStatus | null {
  const text = cellText(raw);
  if (/out.of.network|not covered/i.test(text)) return "out_of_network";
  if (/preferred/i.test(text)) return "preferred";
  if (/standard/i.test(text)) return "standard";
  return null;
}

/** "Sav-On Pharmacy (inside Albertsons)" → "Sav-On"; "CVS Specialty" → "CVS Specialty". */
export function chainPattern(label: string): string {
  return label
    .replace(/\([^)]*\)/g, " ")
    .replace(/\bpharmacy\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function parsePharmacyNetworkSheet(rows: SheetRows): PharmacyNetworkRule[] {
  const header = findHeader(rows, [/^pharmacy$/, /status/]);
  if (!header) return [];
  const nameCol = colOf(header, /^pharmacy$/)!;
  const statusCol = colOf(header, /status/)!;
  const noteCol = colOf(header, /evidence|notes/);

  const rules: PharmacyNetworkRule[] = [];
  for (const row of rows.slice(header.rowIndex + 1)) {
    const label = cellText(row[nameCol]);
    const status = parseNetworkStatus(row[statusCol]);
    if (label === "" || status === null) continue;
    const pattern = chainPattern(label);
    if (pattern === "") continue;
    rules.push({
      label,
      pattern,
      status,
      note: noteCol === null ? null : cellText(row[noteCol]) || null,
    });
  }
  // Longest pattern first so "CVS Specialty" claims its pharmacies before "CVS".
  return rules.sort((a, b) => b.pattern.length - a.pattern.length);
}

// ─── Sheet discovery ─────────────────────────────────────────────────────────

export interface ParsedCarrierWorkbook {
  tierPricing: TierPricingRow[];
  networkRules: PharmacyNetworkRule[];
  warnings: string[];
}

export function parseCarrierWorkbook(workbook: WorkbookSheets): ParsedCarrierWorkbook {
  const warnings: string[] = [];

  const findByName = (pattern: RegExp): string | null =>
    workbook.names.find((n) => pattern.test(n)) ?? null;

  let tierPricing: TierPricingRow[] = [];
  const tierSheet = findByName(/tier pricing/i);
  const tierSheetNames = tierSheet ? [tierSheet] : workbook.names;
  for (const name of tierSheetNames) {
    tierPricing = parseTierPricingSheet(workbook.rows(name));
    if (tierPricing.length > 0) break;
  }
  if (tierPricing.length === 0) warnings.push("No tier-pricing sheet recognized");

  let networkRules: PharmacyNetworkRule[] = [];
  const networkSheet = findByName(/pharmacy network/i);
  const networkSheetNames = networkSheet ? [networkSheet] : workbook.names;
  for (const name of networkSheetNames) {
    networkRules = parsePharmacyNetworkSheet(workbook.rows(name));
    if (networkRules.length > 0) break;
  }
  if (networkRules.length === 0) warnings.push("No pharmacy-network sheet recognized");

  return { tierPricing, networkRules, warnings };
}
