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
  tierLabel,
  type PlanTierLabels,
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

/** Column order + header wording for a plan's benefit table, per channel. */
const CHANNEL_COLUMN: Record<PharmacyChannel, { order: number; header: string; days: number }> = {
  standard_retail: { order: 0, header: "DAY Standard", days: 30 },
  preferred_retail: { order: 1, header: "Day Preferred", days: 30 },
  standard_mail: { order: 2, header: "DAY Standard Mail", days: 90 },
  preferred_mail: { order: 3, header: "DAY Preferred Mail", days: 90 },
};

/**
 * Channel columns for a plan's benefit table — one per channel the plan
 * actually publishes, in a stable order (retail before mail, standard before
 * preferred). A lone retail network reads "30 DAY In Network".
 */
export function buildChannelColumns(
  tierCosts: BenefitTierCost[],
): { channels: PharmacyChannel[]; headers: string[] } {
  const present = new Set(tierCosts.map((c) => c.channel));
  const daysFor = (channel: PharmacyChannel): number =>
    tierCosts.find((c) => c.channel === channel)?.daysSupply ?? CHANNEL_COLUMN[channel].days;

  const channels = [...present].sort((a, b) => CHANNEL_COLUMN[a].order - CHANNEL_COLUMN[b].order);

  // Single retail network with no mail → the sample reports label it "In Network".
  const soleRetail =
    channels.length === 1 &&
    (channels[0] === "standard_retail" || channels[0] === "preferred_retail");

  const headers = channels.map((channel) =>
    soleRetail
      ? `${daysFor(channel)} DAY In Network`
      : `${daysFor(channel)} ${CHANNEL_COLUMN[channel].header}`,
  );

  return { channels, headers };
}

export function buildTierRows(
  tierCosts: BenefitTierCost[],
  channels: PharmacyChannel[],
  planTierLabels?: PlanTierLabels,
): ReportTierRow[] {
  const rows: ReportTierRow[] = [];
  for (const tier of TIER_ORDER) {
    const perChannel = channels.map(
      (channel) => tierCosts.find((c) => c.channel === channel && c.tier === tier) ?? null,
    );
    if (perChannel.every((c) => c == null)) continue;
    rows.push({
      label: tierLabel(tier, planTierLabels),
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
  /** Per-plan SoB tier labels; fallback T1.. when absent. */
  tierLabels?: PlanTierLabels;
}): ReportPlanBenefits {
  const { channels, headers } = buildChannelColumns(input.tierCosts);
  return {
    planName: input.planName,
    carrierName: input.carrierName,
    premium: input.premiumCents == null ? "—" : formatCents(input.premiumCents),
    rxDeductible: input.rxDeductibleCents == null ? "—" : formatCents(input.rxDeductibleCents),
    channelHeaders: headers,
    channels,
    tierRows: buildTierRows(input.tierCosts, channels, input.tierLabels),
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
