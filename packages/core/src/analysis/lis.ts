/**
 * CMS Low-Income Subsidy (Extra Help) maximum Part D copays. D-SNP members
 * pay these amounts by their dual/LIS category and the drug's brand/generic
 * status — plan tiers and channels do not apply, and the deductible is $0.
 * Amounts are set by CMS per plan year; extend the table each fall.
 */
import type { Cents } from "../types";

export type LisCategory =
  | "full_medicaid_le_100_fpl"
  | "full_medicaid_gt_100_fpl"
  | "institutional_or_hcbs"
  | "other_full_lis";

export const LIS_CATEGORIES: LisCategory[] = [
  "full_medicaid_le_100_fpl",
  "full_medicaid_gt_100_fpl",
  "institutional_or_hcbs",
  "other_full_lis",
];

/** Admin-facing wording, mirroring the CMS table rows. */
export const LIS_CATEGORY_LABELS: Record<LisCategory, string> = {
  full_medicaid_le_100_fpl: "Full Medicaid, income ≤100% FPL",
  full_medicaid_gt_100_fpl: "Full Medicaid, income >100–150% FPL",
  institutional_or_hcbs: "Institutionalized or qualifying HCBS",
  other_full_lis: "QMB / SLMB / QI / other full LIS",
};

interface LisCopays {
  genericCents: Cents;
  brandCents: Cents;
}

const LIS_COPAYS_BY_YEAR: Record<number, Record<LisCategory, LisCopays>> = {
  2026: {
    full_medicaid_le_100_fpl: { genericCents: 160, brandCents: 490 },
    full_medicaid_gt_100_fpl: { genericCents: 510, brandCents: 1265 },
    institutional_or_hcbs: { genericCents: 0, brandCents: 0 },
    other_full_lis: { genericCents: 510, brandCents: 1265 },
  },
};

/**
 * Per-fill copay for an LIS member. Null when the plan year's schedule isn't
 * on file — callers must show "LIS copay applies" rather than a number.
 */
export function lisCopayCents(
  planYear: number,
  category: LisCategory,
  isBrand: boolean,
): Cents | null {
  const schedule = LIS_COPAYS_BY_YEAR[planYear];
  if (!schedule) return null;
  const copays = schedule[category];
  return isBrand ? copays.brandCents : copays.genericCents;
}
