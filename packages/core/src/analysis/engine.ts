/**
 * The analysis engine: pure, deterministic matching + pricing.
 * No I/O, no AI — callers fetch rows, the engine joins them. Every result
 * carries its match method and the matched entry id (provenance).
 *
 * Matching order per medication × plan (Strategy doc §4.4):
 *   1. exact RXCUI intersection
 *   2. ingredient + strength + form (normalized name containment)
 *   3. brand/generic crosswalk via related RXCUIs (honoring Generic OK)
 *   4. fuzzy name match → needsConfirmation
 *   5. none → not_on_formulary
 */
import type {
  Cents,
  CostTier,
  CoverageStatus,
  MatchMethod,
  NetworkStatus,
  PharmacyChannel,
} from "../types";
import { tierFromNumber } from "../types";

// ── Inputs ───────────────────────────────────────────────────────────────────

export interface EngineMedication {
  id: string;
  name: string;
  /** Normalized lowercase "ingredient strength form" if known. */
  normalizedName: string | null;
  /** Own RXCUI(s) for the prescribed product. */
  rxcuis: string[];
  /** RXCUIs of brand/generic equivalents (from RxNorm crosswalk). */
  relatedRxcuis: string[];
  genericOk: boolean;
  prn: boolean;
  quantity: number | null;
  daysSupply: number | null;
}

export interface EngineFormularyEntry {
  id: string;
  rawDrugName: string;
  normalizedName: string | null;
  rxcuis: string[];
  isBrand: boolean;
  tier: number;
  pa: boolean;
  st: boolean;
  qlQuantity: number | null;
  qlDays: number | null;
  extraFlags: string[];
}

export interface EngineTierCost {
  channel: PharmacyChannel;
  tier: CostTier;
  daysSupply: number;
  copayCents: Cents | null;
  coinsurancePct: number | null;
}

export interface EnginePlan {
  id: string;
  name: string;
  premiumCents: Cents | null;
  rxDeductibleCents: Cents | null;
  deductibleTiers: number[];
  entries: EngineFormularyEntry[];
  tierCosts: EngineTierCost[];
  /** Client pharmacy's network status on this plan; null = unknown. */
  clientPharmacyStatus: NetworkStatus | null;
}

// ── Outputs ──────────────────────────────────────────────────────────────────

export interface CellResult {
  medicationId: string;
  planId: string;
  coverage: CoverageStatus;
  matchMethod: MatchMethod;
  matchedEntryId: string | null;
  substitutionNote: string | null;
  tier: number | null;
  restrictions: {
    pa: boolean;
    st: boolean;
    ql: { quantity: number; days: number } | null;
    extraFlags: string[];
  } | null;
  /** Cost at the priced channel; exactly one of copayCents/coinsurancePct set when covered. */
  copayCents: Cents | null;
  coinsurancePct: number | null;
  needsConfirmation: boolean;
}

export interface PlanSummary {
  planId: string;
  coveredCount: number;
  totalCount: number;
  paCount: number;
  stCount: number;
  qlCount: number;
  /** Sum of 30-day-normalized copays for covered, non-PRN meds. Null if any covered med is coinsurance-priced. */
  estMonthlyCents: Cents | null;
  estMonthlyIsPartial: boolean;
  pricedChannel: PharmacyChannel;
}

export interface AnalysisOutput {
  cells: CellResult[];
  summaries: PlanSummary[];
}

// ── Matching ─────────────────────────────────────────────────────────────────

const normalize = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9./% ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const tokens = (s: string) => new Set(normalize(s).split(" ").filter(Boolean));

const intersects = (a: string[], b: string[]) => {
  if (a.length === 0 || b.length === 0) return false;
  const set = new Set(a);
  return b.some((x) => set.has(x));
};

interface Match {
  entry: EngineFormularyEntry;
  method: MatchMethod;
  needsConfirmation: boolean;
  substitutionNote: string | null;
}

export function matchMedication(
  med: EngineMedication,
  entries: EngineFormularyEntry[],
): Match | null {
  // 1. exact RXCUI
  for (const entry of entries) {
    if (intersects(med.rxcuis, entry.rxcuis)) {
      return { entry, method: "exact_rxcui", needsConfirmation: false, substitutionNote: null };
    }
  }

  // 2. ingredient + strength + form via normalized name containment
  if (med.normalizedName) {
    const medTokens = tokens(med.normalizedName);
    for (const entry of entries) {
      if (!entry.normalizedName) continue;
      const entryTokens = tokens(entry.normalizedName);
      let contained = true;
      for (const t of medTokens) {
        if (!entryTokens.has(t)) {
          contained = false;
          break;
        }
      }
      if (contained && medTokens.size > 0) {
        return {
          entry,
          method: "ingredient_strength_form",
          needsConfirmation: false,
          substitutionNote: null,
        };
      }
    }
  }

  // 3. brand/generic crosswalk (only when Generic OK, or brand equivalent of a generic)
  if (med.relatedRxcuis.length > 0) {
    for (const entry of entries) {
      if (intersects(med.relatedRxcuis, entry.rxcuis)) {
        if (!med.genericOk && !entry.isBrand) continue; // client requires brand; entry is generic
        const note = entry.isBrand
          ? `Generic is Not Cov · covered as brand (${entry.rawDrugName})`
          : `Covered as generic equivalent (${entry.rawDrugName})`;
        return {
          entry,
          method: "brand_generic_crosswalk",
          needsConfirmation: false,
          substitutionNote: note,
        };
      }
    }
  }

  // 4. fuzzy name: primary token (ingredient) match, flagged for agent confirmation
  const medPrimary = normalize(med.normalizedName ?? med.name).split(" ")[0];
  if (medPrimary && medPrimary.length >= 4) {
    for (const entry of entries) {
      const entryNorm = normalize(entry.normalizedName ?? entry.rawDrugName);
      if (entryNorm.startsWith(medPrimary) || entryNorm.includes(` ${medPrimary}`)) {
        return { entry, method: "fuzzy_name", needsConfirmation: true, substitutionNote: null };
      }
    }
  }

  return null;
}

// ── Pricing ──────────────────────────────────────────────────────────────────

/** Which cost-sharing channel applies for a plan given the pricing context. */
export function resolveChannel(
  clientPharmacyStatus: NetworkStatus | null,
  channelOverride: PharmacyChannel | null,
): PharmacyChannel | null {
  if (channelOverride) return channelOverride;
  switch (clientPharmacyStatus) {
    case "preferred":
      return "preferred_retail";
    case "standard":
      return "standard_retail";
    case "out_of_network":
      return null; // plan won't price at this pharmacy
    case null:
      return "preferred_retail"; // "(most efficient)" default when no pharmacy given
  }
}

export function findTierCost(
  tierCosts: EngineTierCost[],
  tier: number,
  channel: PharmacyChannel,
): EngineTierCost | null {
  const costTier = tierFromNumber(tier);
  const exact = tierCosts.find((c) => c.channel === channel && c.tier === costTier);
  if (exact) return exact;
  // Plans without a preferred network fall back to their standard table (and vice versa).
  const fallbackChannel: PharmacyChannel =
    channel === "preferred_retail" ? "standard_retail" : "preferred_retail";
  if (channel !== "mail_order") {
    return tierCosts.find((c) => c.channel === fallbackChannel && c.tier === costTier) ?? null;
  }
  return null;
}

// ── Orchestration ────────────────────────────────────────────────────────────

export function runAnalysis(
  medications: EngineMedication[],
  plans: EnginePlan[],
  channelOverride: PharmacyChannel | null = null,
): AnalysisOutput {
  const cells: CellResult[] = [];
  const summaries: PlanSummary[] = [];

  for (const plan of plans) {
    const channel = resolveChannel(plan.clientPharmacyStatus, channelOverride);
    let covered = 0;
    let paCount = 0;
    let stCount = 0;
    let qlCount = 0;
    let estMonthly: Cents = 0;
    let estMonthlyValid = true;
    let estMonthlyPartial = false;

    for (const med of medications) {
      const match = matchMedication(med, plan.entries);

      if (!match) {
        cells.push({
          medicationId: med.id,
          planId: plan.id,
          coverage: "not_on_formulary",
          matchMethod: "none",
          matchedEntryId: null,
          substitutionNote: null,
          tier: null,
          restrictions: null,
          copayCents: null,
          coinsurancePct: null,
          needsConfirmation: false,
        });
        continue;
      }

      const { entry } = match;
      covered += 1;
      if (entry.pa) paCount += 1;
      if (entry.st) stCount += 1;
      if (entry.qlQuantity != null) qlCount += 1;

      const cost = channel ? findTierCost(plan.tierCosts, entry.tier, channel) : null;

      if (!med.prn) {
        if (cost?.copayCents != null) {
          // Normalize to a 30-day month: a 90-day mail-order copay is ÷3.
          estMonthly += Math.round(cost.copayCents * (30 / cost.daysSupply));
        } else if (cost?.coinsurancePct != null) {
          estMonthlyValid = false; // can't know $ without a drug price
        } else {
          estMonthlyPartial = true; // missing tier-cost row or out-of-network
        }
      }

      cells.push({
        medicationId: med.id,
        planId: plan.id,
        coverage:
          match.method === "brand_generic_crosswalk" ? "covered_equivalent" : "covered",
        matchMethod: match.method,
        matchedEntryId: entry.id,
        substitutionNote: match.substitutionNote,
        tier: entry.tier,
        restrictions: {
          pa: entry.pa,
          st: entry.st,
          ql:
            entry.qlQuantity != null && entry.qlDays != null
              ? { quantity: entry.qlQuantity, days: entry.qlDays }
              : null,
          extraFlags: entry.extraFlags,
        },
        copayCents: cost?.copayCents ?? null,
        coinsurancePct: cost?.coinsurancePct ?? null,
        needsConfirmation: match.needsConfirmation,
      });
    }

    summaries.push({
      planId: plan.id,
      coveredCount: covered,
      totalCount: medications.length,
      paCount,
      stCount,
      qlCount,
      estMonthlyCents: estMonthlyValid ? estMonthly : null,
      estMonthlyIsPartial: estMonthlyPartial,
      pricedChannel: channel ?? "standard_retail",
    });
  }

  return { cells, summaries };
}
