/**
 * Pure display-string formatting for the report model. No I/O — everything
 * here is unit-testable with fixture data. Target strings match the agency's
 * existing Word reports: "$8 -T2", "Not Covered", "50% Cost of Medication",
 * "Generic is Not Cov · $47 -T3 (Brand)".
 */
import type { Cents, CostTier, CoverageStatus, NetworkStatus, PharmacyChannel } from "@rxsr/core";
import {
  centsDisplay,
  DEFAULT_DEDUCTIBLE_FOOTNOTE,
  TIER_LABELS,
  type ReportPlanBenefits,
  type ReportTierRow,
} from "@rxsr/core/report-model";
import { formatCents } from "@rxsr/core";

export interface DisplayCellInput {
  coverage: CoverageStatus;
  tier: number | null;
  copayCents: Cents | null;
  coinsurancePct: number | null;
  substitutionNote: string | null;
}

export function formatCoinsurance(pct: number): string {
  const rounded = Number.isInteger(pct)
    ? String(pct)
    : pct.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
  return `${rounded}%`;
}

function formatCoveredCost(cell: DisplayCellInput): string {
  if (cell.copayCents != null && cell.tier != null) {
    return `${centsDisplay(cell.copayCents)} -T${cell.tier}`;
  }
  if (cell.coinsurancePct != null) {
    return `${formatCoinsurance(cell.coinsurancePct)} Cost of Medication`;
  }
  if (cell.tier != null) return `T${cell.tier}`;
  return "Covered";
}

export function formatGridCellDisplay(cell: DisplayCellInput): string {
  switch (cell.coverage) {
    case "not_covered":
    case "not_on_formulary":
      return "Not Covered";
    case "covered":
      return formatCoveredCost(cell);
    case "covered_equivalent": {
      const base = formatCoveredCost(cell);
      const note = cell.substitutionNote ?? "";
      if (note.startsWith("Generic is Not Cov")) return `Generic is Not Cov · ${base} (Brand)`;
      if (note.startsWith("Covered as generic")) return `${base} (Generic)`;
      return note ? `${note} · ${base}` : base;
    }
  }
}

export const formatMedicationName = (name: string, prn: boolean): string =>
  prn ? `${name} (prn)` : name;

export interface BenefitTierCost {
  channel: PharmacyChannel;
  tier: CostTier;
  daysSupply: number;
  copayCents: Cents | null;
  coinsurancePct: number | null;
}

const TIER_ORDER: CostTier[] = ["t1", "t2", "t3", "t4", "t5", "t6", "insulin"];

/**
 * Channel columns for a plan's benefit table. Both retail networks priced →
 * "30 DAY Standard" + "30 Day Preferred" (casing per the sample reports);
 * one retail network → "30 DAY In Network"; mail order appears only when the
 * analysis actually priced with it.
 */
export function buildChannelColumns(
  tierCosts: BenefitTierCost[],
  includeMailOrder: boolean,
): { channels: PharmacyChannel[]; headers: string[] } {
  const present = new Set(tierCosts.map((c) => c.channel));
  const daysFor = (channel: PharmacyChannel, fallback: number): number =>
    tierCosts.find((c) => c.channel === channel)?.daysSupply ?? fallback;

  const channels: PharmacyChannel[] = [];
  const headers: string[] = [];

  const hasStandard = present.has("standard_retail");
  const hasPreferred = present.has("preferred_retail");
  if (hasStandard && hasPreferred) {
    channels.push("standard_retail", "preferred_retail");
    headers.push(
      `${daysFor("standard_retail", 30)} DAY Standard`,
      `${daysFor("preferred_retail", 30)} Day Preferred`,
    );
  } else if (hasStandard || hasPreferred) {
    const channel: PharmacyChannel = hasStandard ? "standard_retail" : "preferred_retail";
    channels.push(channel);
    headers.push(`${daysFor(channel, 30)} DAY In Network`);
  }

  if (includeMailOrder && present.has("mail_order")) {
    channels.push("mail_order");
    headers.push(`${daysFor("mail_order", 90)} DAY Mail Order`);
  }

  return { channels, headers };
}

export function buildTierRows(
  tierCosts: BenefitTierCost[],
  channels: PharmacyChannel[],
): ReportTierRow[] {
  const rows: ReportTierRow[] = [];
  for (const tier of TIER_ORDER) {
    const perChannel = channels.map(
      (channel) => tierCosts.find((c) => c.channel === channel && c.tier === tier) ?? null,
    );
    if (perChannel.every((c) => c == null)) continue;
    rows.push({
      label: TIER_LABELS[tier],
      values: perChannel.map((cost) => {
        if (!cost) return "—";
        if (cost.copayCents != null) return centsDisplay(cost.copayCents);
        if (cost.coinsurancePct != null) return formatCoinsurance(cost.coinsurancePct);
        return "—";
      }),
    });
  }
  return rows;
}

export function buildPlanBenefits(input: {
  planName: string;
  carrierName: string;
  premiumCents: Cents | null;
  rxDeductibleCents: Cents | null;
  tierCosts: BenefitTierCost[];
  includeMailOrder: boolean;
}): ReportPlanBenefits {
  const { channels, headers } = buildChannelColumns(input.tierCosts, input.includeMailOrder);
  return {
    planName: input.planName,
    carrierName: input.carrierName,
    premium: input.premiumCents == null ? "—" : formatCents(input.premiumCents),
    rxDeductible: input.rxDeductibleCents == null ? "—" : formatCents(input.rxDeductibleCents),
    channelHeaders: headers,
    channels,
    tierRows: buildTierRows(input.tierCosts, channels),
  };
}

/** Generated per plan when the client's pharmacy is not preferred there. */
export function pharmacyNote(
  pharmacyName: string,
  planName: string,
  status: NetworkStatus,
): string | null {
  switch (status) {
    case "standard":
      return `${pharmacyName} — you will receive Standard Pricing on the ${planName} plan.`;
    case "out_of_network":
      return `${pharmacyName} — is Out of Network on the ${planName} plan.`;
    case "preferred":
      return null;
  }
}

const tierList = (tiers: number[]): string => {
  const sorted = [...tiers].sort((a, b) => a - b).map((t) => `Tier ${t}`);
  if (sorted.length === 1) return sorted[0]!;
  return `${sorted.slice(0, -1).join(", ")} and ${sorted[sorted.length - 1]}`;
};

/**
 * One shared sentence when every plan applies its deductible to the same
 * tiers; otherwise one sentence per plan that has deductible tiers.
 */
export function buildDeductibleFootnote(
  plans: { name: string; deductibleTiers: number[] }[],
): string | null {
  const withTiers = plans.filter((p) => p.deductibleTiers.length > 0);
  if (withTiers.length === 0) return null;

  const key = (tiers: number[]) => [...tiers].sort((a, b) => a - b).join(",");
  const firstKey = key(withTiers[0]!.deductibleTiers);
  const allShared =
    withTiers.length === plans.length && withTiers.every((p) => key(p.deductibleTiers) === firstKey);

  if (allShared) {
    return DEFAULT_DEDUCTIBLE_FOOTNOTE(
      [...withTiers[0]!.deductibleTiers].sort((a, b) => a - b),
    );
  }
  return withTiers
    .map((p) => `RX Deductible applies to ${tierList(p.deductibleTiers)} medications on the ${p.name} plan.`)
    .join(" ");
}
