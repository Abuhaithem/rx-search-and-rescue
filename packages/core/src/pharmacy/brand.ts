/**
 * Brand derivation: one chain, many locations. A location's printed name
 * carries store identity ("Walgreens Pharmacy #10603", "Fred Meyer Pharmacy
 * (Franklin Rd)"); the brand is that name with the per-store suffix removed.
 * Independents derive to themselves — a brand with one location — so every
 * pharmacy has a brand and grouping logic needs no special cases.
 * The SQL backfill in migration 0015 mirrors these exact rules.
 */

const STORE_NUMBER_SUFFIX_RE = /\s*#\s*\d+\s*$/;
const PARENTHETICAL_SUFFIX_RE = /\s*\([^)]*\)\s*$/;

export function derivePharmacyBrandName(name: string): string {
  const stripped = name
    .replace(STORE_NUMBER_SUFFIX_RE, "")
    .replace(PARENTHETICAL_SUFFIX_RE, "")
    .replace(/\s+/g, " ")
    .trim();
  return stripped.length >= 2 ? stripped : name.trim();
}

/** Grouping/uniqueness key for a brand name. */
export function normalizePharmacyBrandName(name: string): string {
  return derivePharmacyBrandName(name).toLowerCase();
}
