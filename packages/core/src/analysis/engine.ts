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
import { lisCopayCents, type LisCategory } from "./lis";

// ── Inputs ───────────────────────────────────────────────────────────────────

export interface EngineMedication {
  id: string;
  name: string;
  /** Normalized lowercase "ingredient strength form" if known. */
  normalizedName: string | null;
  /** Own RXCUI(s) for the prescribed product. */
  rxcuis: string[];
  /** RXCUIs of brand/generic equivalents (name-based matching is primary). */
  relatedRxcuis: string[];
  /**
   * Generic key from the ingestion-time resolution ladder ("Zetia" →
   * "ezetimibe"); powers the name-based brand/generic crosswalk.
   */
  resolvedGenericName?: string | null;
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
  /**
   * D-SNP: drug costs follow the CMS LIS schedule (client category ×
   * brand/generic), not tier costs. tierCosts are ignored when true.
   */
  lisCostSharing?: boolean;
}

/** Client-side pricing context for LIS (D-SNP) plans. */
export interface LisContext {
  planYear: number;
  /** Null = client's dual/LIS category unknown → no dollar figures. */
  category: LisCategory | null;
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

// ── Cost matrix (one pharmacy row × plan column) ─────────────────────────────

/** A pharmacy the client is comparing, with its resolved channel per plan. */
export interface PricingScenario {
  /** Pharmacy id, or a synthetic key like "mail" for the plan's mail benefit. */
  key: string;
  label: string;
  kind: "retail" | "mail";
  /** Resolved channel per plan id; null = pharmacy can't fill on that plan (OON / no such channel). */
  channelByPlan: Record<string, PharmacyChannel | null>;
}

export interface CostMatrixCell {
  scenarioKey: string;
  planId: string;
  channel: PharmacyChannel | null;
  /** Channel is null on this plan — the pharmacy is out of network / unavailable. */
  unavailable: boolean;
  /** Sum of 30-day-normalized copays for covered, non-PRN meds. Null when unavailable or any such med is coinsurance-priced. */
  estMonthlyCents: Cents | null;
  /** A covered, non-PRN med had no cost row for this channel — the total understates. */
  isPartial: boolean;
  /** At least one covered, non-PRN med is coinsurance-priced (can't total to a dollar figure). */
  hasCoinsurance: boolean;
}

// ── Matching ─────────────────────────────────────────────────────────────────

/**
 * The two sides spell the same drug differently: RxC dosage text says
 * "TAB 5MG", formularies print "oral tablet 5 mg". Canonicalization makes
 * both sides produce identical tokens so strength+form matches land as
 * confident ingredient_strength_form instead of falling through to fuzzy.
 */
const TOKEN_SYNONYMS: Record<string, string> = {
  tab: "tablet",
  tabs: "tablet",
  tablets: "tablet",
  cap: "capsule",
  caps: "capsule",
  capsules: "capsule",
  sol: "solution",
  soln: "solution",
  susp: "suspension",
  inj: "injection",
  cre: "cream",
  oin: "ointment",
  syp: "syrup",
  inh: "inhaler",
  lot: "lotion",
  supp: "suppository",
  hydrochloride: "hcl",
  xr: "er",
  xl: "er",
  sr: "er",
};

const PHRASE_SYNONYMS: [RegExp, string][] = [
  [/\bextended[- ]release\b/g, " er "],
  [/\bdelayed[- ]release\b/g, " dr "],
];

const normalize = (s: string) => {
  let out = s.toLowerCase();
  for (const [pattern, replacement] of PHRASE_SYNONYMS) out = out.replace(pattern, replacement);
  return out
    .replace(/[^a-z0-9./% ]+/g, " ")
    // "5mg" → "5 mg", "mg5" → "mg 5": both sides split identically.
    .replace(/(\d)([a-z%])/g, "$1 $2")
    .replace(/([a-z])(\d)/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();
};

const canonicalToken = (t: string): string => TOKEN_SYNONYMS[t] ?? t;

const tokens = (s: string) =>
  new Set(normalize(s).split(" ").filter(Boolean).map(canonicalToken));

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

  // 2. ingredient + strength + form via normalized token containment.
  // All containing entries compete: the TIGHTEST wins (fewest extra tokens),
  // ties broken by lower tier — a med with a strength picks its own strength
  // row, never an arbitrary first hit.
  if (med.normalizedName) {
    const medTokens = tokens(med.normalizedName);
    if (medTokens.size > 0) {
      let best: { entry: EngineFormularyEntry; extra: number } | null = null;
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
        if (!contained) continue;
        const extra = entryTokens.size - medTokens.size;
        if (
          best === null ||
          extra < best.extra ||
          (extra === best.extra && entry.tier < best.entry.tier)
        ) {
          best = { entry, extra };
        }
      }
      if (best) {
        return {
          entry: best.entry,
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

  // 3b. Resolved-generic crosswalk: the ingestion-time resolution ladder
  // mapped the written name to a generic key ("Zetia" → "ezetimibe"); match
  // it against entry names the same way step 2 matches the medication name.
  // A client who requires brand never lands on a generic entry here.
  if (med.resolvedGenericName) {
    const genericTokens = tokens(med.resolvedGenericName);
    if (genericTokens.size > 0) {
      let best: { entry: EngineFormularyEntry; extra: number } | null = null;
      for (const entry of entries) {
        if (!entry.isBrand && !med.genericOk) continue; // client requires brand
        const entryTokens = tokens(entry.normalizedName ?? entry.rawDrugName);
        let contained = true;
        for (const t of genericTokens) {
          if (!entryTokens.has(t)) {
            contained = false;
            break;
          }
        }
        if (!contained) continue;
        const extra = entryTokens.size - genericTokens.size;
        if (
          best === null ||
          extra < best.extra ||
          (extra === best.extra && entry.tier < best.entry.tier)
        ) {
          best = { entry, extra };
        }
      }
      if (best) {
        return {
          entry: best.entry,
          method: "brand_generic_crosswalk",
          needsConfirmation: false,
          substitutionNote: best.entry.isBrand
            ? `Covered as brand (${best.entry.rawDrugName})`
            : `Covered as generic equivalent (${best.entry.rawDrugName})`,
        };
      }
    }
  }

  // 4. fuzzy name: shared primary token (ingredient) plus the highest token
  // overlap across all candidates — flagged for agent confirmation.
  const medPrimary = normalize(med.normalizedName ?? med.name).split(" ")[0];
  if (medPrimary && medPrimary.length >= 4) {
    const medTokens = tokens(med.normalizedName ?? med.name);
    let best: { entry: EngineFormularyEntry; overlap: number } | null = null;
    for (const entry of entries) {
      const entryNorm = normalize(entry.normalizedName ?? entry.rawDrugName);
      if (!entryNorm.startsWith(medPrimary) && !entryNorm.includes(` ${medPrimary}`)) continue;
      const entryTokens = tokens(entry.normalizedName ?? entry.rawDrugName);
      let shared = 0;
      for (const t of medTokens) if (entryTokens.has(t)) shared += 1;
      const overlap = medTokens.size === 0 ? 0 : shared / medTokens.size;
      if (
        best === null ||
        overlap > best.overlap ||
        (overlap === best.overlap && entry.tier < best.entry.tier)
      ) {
        best = { entry, overlap };
      }
    }
    if (best) {
      return {
        entry: best.entry,
        method: "fuzzy_name",
        needsConfirmation: true,
        substitutionNote: null,
      };
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

/**
 * Fallback partner for a channel: a plan with only a preferred (or only a
 * standard) table prices the other request from what it has. Retail and mail
 * never cross — a mail request never falls back to a retail table.
 */
const CHANNEL_FALLBACK: Record<PharmacyChannel, PharmacyChannel> = {
  preferred_retail: "standard_retail",
  standard_retail: "preferred_retail",
  preferred_mail: "standard_mail",
  standard_mail: "preferred_mail",
};

export function findTierCost(
  tierCosts: EngineTierCost[],
  tier: number,
  channel: PharmacyChannel,
): EngineTierCost | null {
  const costTier = tierFromNumber(tier);
  const exact = tierCosts.find((c) => c.channel === channel && c.tier === costTier);
  if (exact) return exact;
  const fallbackChannel = CHANNEL_FALLBACK[channel];
  return tierCosts.find((c) => c.channel === fallbackChannel && c.tier === costTier) ?? null;
}

/** A cost-sharing row normalized to a 30-day month (90-day mail ÷ 3). */
const monthlyCopayCents = (cost: EngineTierCost): Cents | null =>
  cost.copayCents == null ? null : Math.round(cost.copayCents * (30 / cost.daysSupply));

// ── Orchestration ────────────────────────────────────────────────────────────

export function runAnalysis(
  medications: EngineMedication[],
  plans: EnginePlan[],
  channelOverride: PharmacyChannel | null = null,
  lis: LisContext | null = null,
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

      // LIS (D-SNP) plans price from the CMS schedule: category × brand.
      // Tier costs and channels don't apply; a per-fill copay ≈ a month.
      let cellCopayCents: Cents | null;
      let cellCoinsurancePct: number | null;
      if (plan.lisCostSharing === true) {
        cellCopayCents =
          lis && lis.category != null
            ? lisCopayCents(lis.planYear, lis.category, entry.isBrand)
            : null;
        cellCoinsurancePct = null;
        if (!med.prn) {
          if (cellCopayCents != null) estMonthly += cellCopayCents;
          else estMonthlyPartial = true; // LIS category unknown → no dollars
        }
      } else {
        const cost = channel ? findTierCost(plan.tierCosts, entry.tier, channel) : null;
        cellCopayCents = cost?.copayCents ?? null;
        cellCoinsurancePct = cost?.coinsurancePct ?? null;

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
        copayCents: cellCopayCents,
        coinsurancePct: cellCoinsurancePct,
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

/**
 * The cost matrix: each pharmacy scenario priced against every plan, reusing
 * the coverage cells from runAnalysis (no re-matching). One CostMatrixCell per
 * (scenario, plan) — the client's estimated monthly at that pharmacy on that
 * plan. Pure and deterministic, same as runAnalysis.
 */
export function priceScenarios(
  cells: CellResult[],
  medications: EngineMedication[],
  plans: EnginePlan[],
  scenarios: PricingScenario[],
  lis: LisContext | null = null,
): CostMatrixCell[] {
  const prnById = new Map(medications.map((m) => [m.id, m.prn]));
  const cellByKey = new Map(cells.map((c) => [`${c.medicationId}:${c.planId}`, c]));
  const entryById = new Map(
    plans.flatMap((p) => p.entries.map((e) => [e.id, e] as const)),
  );
  const out: CostMatrixCell[] = [];

  for (const scenario of scenarios) {
    for (const plan of plans) {
      const channel = scenario.channelByPlan[plan.id] ?? null;
      if (!channel) {
        out.push({
          scenarioKey: scenario.key,
          planId: plan.id,
          channel: null,
          unavailable: true,
          estMonthlyCents: null,
          isPartial: false,
          hasCoinsurance: false,
        });
        continue;
      }

      let estMonthly: Cents = 0;
      let hasCoinsurance = false;
      let isPartial = false;

      for (const med of medications) {
        if (prnById.get(med.id)) continue; // PRN meds are not part of the monthly estimate
        const cell = cellByKey.get(`${med.id}:${plan.id}`);
        if (!cell || cell.tier == null) continue; // not covered / not on formulary
        if (cell.coverage !== "covered" && cell.coverage !== "covered_equivalent") continue;

        // LIS (D-SNP) plans cost the same at every in-network pharmacy.
        if (plan.lisCostSharing === true) {
          const entry = cell.matchedEntryId ? entryById.get(cell.matchedEntryId) : undefined;
          const copay =
            entry && lis && lis.category != null
              ? lisCopayCents(lis.planYear, lis.category, entry.isBrand)
              : null;
          if (copay != null) estMonthly += copay;
          else isPartial = true;
          continue;
        }

        const cost = findTierCost(plan.tierCosts, cell.tier, channel);
        const monthly = cost ? monthlyCopayCents(cost) : null;
        if (monthly != null) estMonthly += monthly;
        else if (cost?.coinsurancePct != null) hasCoinsurance = true;
        else isPartial = true;
      }

      out.push({
        scenarioKey: scenario.key,
        planId: plan.id,
        channel,
        unavailable: false,
        estMonthlyCents: hasCoinsurance ? null : estMonthly,
        isPartial,
        hasCoinsurance,
      });
    }
  }

  return out;
}

/** Retail network status → the retail channel it prices at (null = out of network). */
export function retailChannelForStatus(status: NetworkStatus | null): PharmacyChannel | null {
  switch (status) {
    case "preferred":
      return "preferred_retail";
    case "standard":
      return "standard_retail";
    case "out_of_network":
      return null;
    case null:
      return "standard_retail"; // unknown network → conservative default (flagged for confirmation upstream)
  }
}

/** The mail channel a plan offers, preferring its preferred-mail table (e.g. CenterWell). */
export function mailChannelForPlan(tierCosts: EngineTierCost[]): PharmacyChannel | null {
  const channels = new Set(tierCosts.map((c) => c.channel));
  if (channels.has("preferred_mail")) return "preferred_mail";
  if (channels.has("standard_mail")) return "standard_mail";
  return null;
}
