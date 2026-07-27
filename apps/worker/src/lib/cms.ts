/**
 * Pure parsing/mapping for the CMS "Quarterly Prescription Drug Plan
 * Formulary, Pharmacy Network, and Pricing Information Files" (pipe-delimited
 * text tables inside a ZIP). Everything here is column-NAME-driven off each
 * file's header row — never positional — so column reordering in future
 * quarters is tolerated. Rows that fail to parse are counted by the caller
 * and never inserted.
 *
 * ⚠ LIVE-VERIFICATION FLAG: the header names and code values below are taken
 * from the CMS methodology documentation as recalled — this sandbox cannot
 * download the real archive. Verify NETWORK_FILE_HEADERS, COST_FILE_HEADERS,
 * COST_TYPE_* / DAYS_SUPPLY_CODE_* / COVERAGE_LEVEL_INITIAL against the first
 * real file; each field accepts a list of alternative header spellings to
 * widen the tolerance.
 */

export type CmsEntryKind =
  | "pharmacy_networks"
  | "beneficiary_costs"
  | "plan_information"
  | "geographic_locator"
  | "other";

/** Case/space/punctuation-insensitive header canonicalization. */
export const normalizeHeaderName = (name: string): string =>
  name
    .replace(/^﻿/, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

const normalizeEntryName = (name: string): string =>
  name.toLowerCase().replace(/[^a-z0-9]+/g, " ");

export function classifyCmsEntry(fileName: string): CmsEntryKind {
  const n = normalizeEntryName(fileName);
  if (n.includes("pharmacy network")) return "pharmacy_networks";
  if (n.includes("beneficiary cost") && !n.includes("insulin")) return "beneficiary_costs";
  if (n.includes("plan information")) return "plan_information";
  if (n.includes("geographic locator")) return "geographic_locator";
  return "other";
}

// ─── Header specs (verify against the real file on first live run) ───────────

export const NETWORK_FILE_HEADERS = {
  contract: ["CONTRACT_ID"],
  plan: ["PLAN_ID"],
  segment: ["SEGMENT_ID"],
  npi: ["PHARMACY_NUMBER", "NPI", "PROVIDER_ID"],
  preferredRetail: ["PREFERRED_STATUS_RETAIL", "PREFERRED_RETAIL"],
  preferredMail: ["PREFERRED_STATUS_MAIL", "PREFERRED_MAIL"],
  retail: ["PHARMACY_RETAIL", "RETAIL"],
  mail: ["PHARMACY_MAIL", "MAIL"],
} as const;
export const NETWORK_REQUIRED_FIELDS = ["contract", "plan", "npi"] as const;

export const COST_FILE_HEADERS = {
  contract: ["CONTRACT_ID"],
  plan: ["PLAN_ID"],
  segment: ["SEGMENT_ID"],
  coverageLevel: ["COVERAGE_LEVEL"],
  tier: ["TIER"],
  daysSupply: ["DAYS_SUPPLY"],
  costTypePref: ["COST_TYPE_PREF"],
  costAmtPref: ["COST_AMT_PREF"],
  costTypeNonpref: ["COST_TYPE_NONPREF"],
  costAmtNonpref: ["COST_AMT_NONPREF"],
  costTypeMailPref: ["COST_TYPE_MAIL_PREF"],
  costAmtMailPref: ["COST_AMT_MAIL_PREF"],
  costTypeMailNonpref: ["COST_TYPE_MAIL_NONPREF"],
  costAmtMailNonpref: ["COST_AMT_MAIL_NONPREF"],
} as const;
export const COST_REQUIRED_FIELDS = [
  "contract",
  "plan",
  "coverageLevel",
  "tier",
  "daysSupply",
] as const;

/** Code values per the methodology docs — verify on first live run. */
export const COST_TYPE_COPAY = "1";
export const COST_TYPE_COINSURANCE = "2";
export const DAYS_SUPPLY_CODE_ONE_MONTH = "1"; // → 30 days
export const DAYS_SUPPLY_CODE_THREE_MONTH = "2"; // → 90 days
export const COVERAGE_LEVEL_INITIAL = "1"; // initial coverage period rows only

type HeaderSpec = Record<string, readonly string[]>;
export type HeaderIndex<S extends HeaderSpec> = { [K in keyof S]: number };

/**
 * Maps spec fields → column positions by header NAME. Missing optional
 * columns get -1; missing required columns throw with the full list.
 */
export function buildHeaderIndex<S extends HeaderSpec>(
  headerFields: string[],
  spec: S,
  required: readonly (keyof S & string)[],
): HeaderIndex<S> {
  const normalized = headerFields.map(normalizeHeaderName);
  const index = {} as HeaderIndex<S>;
  const missing: string[] = [];
  for (const field of Object.keys(spec) as (keyof S & string)[]) {
    const names = spec[field] ?? [];
    let position = -1;
    for (const name of names) {
      const found = normalized.indexOf(name);
      if (found !== -1) {
        position = found;
        break;
      }
    }
    index[field] = position as HeaderIndex<S>[typeof field];
    if (position === -1 && required.includes(field)) missing.push(names[0] ?? field);
  }
  if (missing.length > 0) {
    throw new Error(
      `CMS file header is missing expected columns: ${missing.join(", ")} (got: ${normalized.join("|")})`,
    );
  }
  return index;
}

// ─── Contract/plan identity ──────────────────────────────────────────────────

export interface ContractPlan {
  contract: string;
  plan: string;
}

/** "H1350-033" (also "H1350_033", "H1350 033", unpadded "H1350-33"). */
export function parseContractPlanId(text: string | null | undefined): ContractPlan | null {
  if (!text) return null;
  const m = text.trim().match(/^([A-Za-z]\d{4})[-_ ]?(\d{1,3})$/);
  if (!m || m[1] === undefined || m[2] === undefined) return null;
  return { contract: m[1].toUpperCase(), plan: m[2].padStart(3, "0") };
}

export const contractPlanKey = (contract: string, plan: string): string =>
  `${contract.trim().toUpperCase()}-${plan.trim().padStart(3, "0")}`;

// ─── Row parsers ─────────────────────────────────────────────────────────────

const truthyFlag = (value: string | undefined): boolean =>
  value !== undefined && /^(y|yes|1|t|true)$/i.test(value.trim());

const field = (fields: string[], index: number): string | undefined =>
  index >= 0 ? fields[index]?.trim() : undefined;

export interface CmsNetworkRow {
  key: string; // contractPlanKey
  npi: string;
  preferredRetail: boolean;
  isRetail: boolean;
  isMail: boolean;
}

export function parseNetworkLine(
  fields: string[],
  index: HeaderIndex<typeof NETWORK_FILE_HEADERS>,
): CmsNetworkRow | null {
  const contract = field(fields, index.contract);
  const plan = field(fields, index.plan);
  const npi = field(fields, index.npi);
  if (!contract || !plan || !npi || !/^\d{10}$/.test(npi)) return null;
  const retailValue = field(fields, index.retail);
  const mailValue = field(fields, index.mail);
  return {
    key: contractPlanKey(contract, plan),
    npi,
    preferredRetail: truthyFlag(field(fields, index.preferredRetail)),
    // Missing retail/mail columns → treat as retail rows (import everything).
    isRetail: retailValue === undefined ? true : truthyFlag(retailValue),
    isMail: mailValue === undefined ? false : truthyFlag(mailValue),
  };
}

export type CmsChannel = "preferred_retail" | "standard_retail" | "mail_order";

export interface CmsCostChannel {
  channel: CmsChannel;
  copayCents: number | null;
  coinsurancePct: string | null; // numeric(5,2) string
  daysSupply: number;
}

export interface CmsCostRow {
  key: string;
  tier: number;
  channels: CmsCostChannel[];
}

export type CostLineResult =
  | { kind: "row"; row: CmsCostRow }
  | { kind: "filtered" } // valid row outside our scope (non-initial coverage)
  | { kind: "malformed" };

function dollarsToCents(value: string | undefined): number | null {
  if (value === undefined || value === "") return null;
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.round(parsed * 100);
}

function percent(value: string | undefined): string | null {
  if (value === undefined || value === "") return null;
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) return null;
  return parsed.toFixed(2);
}

function costChannel(
  channel: CmsChannel,
  daysSupply: number,
  costType: string | undefined,
  costAmt: string | undefined,
): CmsCostChannel | null {
  if (costType === COST_TYPE_COPAY) {
    const copayCents = dollarsToCents(costAmt);
    return copayCents === null
      ? null
      : { channel, daysSupply, copayCents, coinsurancePct: null };
  }
  if (costType === COST_TYPE_COINSURANCE) {
    const coinsurancePct = percent(costAmt);
    return coinsurancePct === null
      ? null
      : { channel, daysSupply, copayCents: null, coinsurancePct };
  }
  return null; // channel not offered / unknown cost-type code
}

export function parseCostLine(
  fields: string[],
  index: HeaderIndex<typeof COST_FILE_HEADERS>,
): CostLineResult {
  const contract = field(fields, index.contract);
  const plan = field(fields, index.plan);
  const tierText = field(fields, index.tier);
  const daysCode = field(fields, index.daysSupply);
  if (!contract || !plan || !tierText || !daysCode) return { kind: "malformed" };

  const coverageLevel = field(fields, index.coverageLevel);
  if (coverageLevel !== undefined && coverageLevel !== COVERAGE_LEVEL_INITIAL) {
    return { kind: "filtered" };
  }

  const tier = Number.parseInt(tierText, 10);
  if (!Number.isInteger(tier) || tier < 1 || tier > 6) return { kind: "filtered" };

  let daysSupply: number;
  if (daysCode === DAYS_SUPPLY_CODE_ONE_MONTH) daysSupply = 30;
  else if (daysCode === DAYS_SUPPLY_CODE_THREE_MONTH) daysSupply = 90;
  else return { kind: "malformed" };

  const channels: CmsCostChannel[] = [];
  const preferred = costChannel(
    "preferred_retail",
    daysSupply,
    field(fields, index.costTypePref),
    field(fields, index.costAmtPref),
  );
  if (preferred) channels.push(preferred);
  const standard = costChannel(
    "standard_retail",
    daysSupply,
    field(fields, index.costTypeNonpref),
    field(fields, index.costAmtNonpref),
  );
  if (standard) channels.push(standard);
  const mail =
    costChannel(
      "mail_order",
      daysSupply,
      field(fields, index.costTypeMailPref),
      field(fields, index.costAmtMailPref),
    ) ??
    costChannel(
      "mail_order",
      daysSupply,
      field(fields, index.costTypeMailNonpref),
      field(fields, index.costAmtMailNonpref),
    );
  if (mail) channels.push(mail);

  if (channels.length === 0) return { kind: "filtered" };
  return { kind: "row", row: { key: contractPlanKey(contract, plan), tier, channels } };
}

// ─── DB-free precedence decisions ────────────────────────────────────────────

export interface NetworkCandidate {
  planId: string;
  pharmacyId: string;
  status: "preferred" | "standard";
}

export interface ExistingNetworkRow {
  planId: string;
  pharmacyId: string;
  source: string;
}

/** Agent-sourced rows always win over the CMS file. */
export function decideNetworkActions(
  candidates: NetworkCandidate[],
  existing: ExistingNetworkRow[],
): { upserts: NetworkCandidate[]; preservedAgent: number } {
  const agentKeys = new Set(
    existing.filter((r) => r.source === "agent").map((r) => `${r.planId}|${r.pharmacyId}`),
  );
  const seen = new Set<string>();
  const upserts: NetworkCandidate[] = [];
  let preservedAgent = 0;
  for (const candidate of candidates) {
    const key = `${candidate.planId}|${candidate.pharmacyId}`;
    if (agentKeys.has(key)) {
      preservedAgent += 1;
      continue;
    }
    if (seen.has(key)) {
      // Duplicate CMS rows for the same pair: "preferred" wins.
      if (candidate.status === "preferred") {
        const existingIndex = upserts.findIndex(
          (u) => u.planId === candidate.planId && u.pharmacyId === candidate.pharmacyId,
        );
        if (existingIndex !== -1) upserts[existingIndex] = candidate;
      }
      continue;
    }
    seen.add(key);
    upserts.push(candidate);
  }
  return { upserts, preservedAgent };
}

export interface CostCandidate {
  planId: string;
  channel: CmsChannel;
  tier: number; // 1..6
  daysSupply: number;
  copayCents: number | null;
  coinsurancePct: string | null;
}

export const costKey = (c: {
  planId: string;
  channel: string;
  tier: number;
  daysSupply: number;
}): string => `${c.planId}|${c.channel}|t${c.tier}|${c.daysSupply}`;

/**
 * Prefill only: rows whose (plan, channel, tier, daysSupply) already exist —
 * admin-typed or previously imported — are never overwritten.
 */
export function decideCostInserts(
  candidates: CostCandidate[],
  existingKeys: Set<string>,
): { inserts: CostCandidate[]; skippedExisting: number } {
  const seen = new Set<string>();
  const inserts: CostCandidate[] = [];
  let skippedExisting = 0;
  for (const candidate of candidates) {
    const key = costKey(candidate);
    if (existingKeys.has(key)) {
      skippedExisting += 1;
      continue;
    }
    if (seen.has(key)) continue; // first CMS row wins within the file
    seen.add(key);
    inserts.push(candidate);
  }
  return { inserts, skippedExisting };
}
