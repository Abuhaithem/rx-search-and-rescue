/**
 * Domain vocabulary shared by every package. Mirrors the DB enums in
 * @rxsr/db/schema — if you change one, change both.
 */

export type PharmacyChannel =
  | "preferred_retail"
  | "standard_retail"
  | "preferred_mail"
  | "standard_mail";

/** Human-readable channel names for UI + client report. */
export const CHANNEL_LABELS: Record<PharmacyChannel, string> = {
  preferred_retail: "Preferred Retail",
  standard_retail: "Standard Retail",
  preferred_mail: "Preferred Mail",
  standard_mail: "Standard Mail",
};

/** Retail channels price 30-day supply; mail channels price 90-day. */
export const RETAIL_CHANNELS: readonly PharmacyChannel[] = ["preferred_retail", "standard_retail"];
export const MAIL_CHANNELS: readonly PharmacyChannel[] = ["preferred_mail", "standard_mail"];
export const isMailChannel = (c: PharmacyChannel): boolean =>
  c === "preferred_mail" || c === "standard_mail";
export const isPreferredChannel = (c: PharmacyChannel): boolean =>
  c === "preferred_retail" || c === "preferred_mail";
export type NetworkStatus = "preferred" | "standard" | "out_of_network";
export type CostTier = "t1" | "t2" | "t3" | "t4" | "t5" | "t6" | "insulin";
export type CoverageStatus =
  | "covered"
  | "covered_equivalent"
  | "not_covered"
  | "not_on_formulary";
export type MatchMethod =
  | "exact_rxcui"
  | "ingredient_strength_form"
  | "brand_generic_crosswalk"
  | "fuzzy_name"
  | "manual"
  | "none";
export type AnalysisStatus = "new" | "in_review" | "approved" | "delivered";
export type PolicyType = "pdp" | "ma_pd" | "med_supp" | "other";
export type UserRole = "agent" | "manager" | "admin";

/** Integer number of cents. All money in the system is cents, never floats. */
export type Cents = number;

export const tierFromNumber = (n: number): CostTier => {
  if (n < 1 || n > 6) throw new Error(`tier out of range: ${n}`);
  return `t${n}` as CostTier;
};

export const tierToNumber = (t: CostTier): number | null =>
  t === "insulin" ? null : Number(t.slice(1));

export const formatCents = (cents: Cents): string =>
  (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
