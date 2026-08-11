/**
 * Shared pharmacy-resolution plumbing for intake and directory jobs. The
 * pharmacies table is the only candidate source — rows enter it from carrier
 * files (pharmacy directories, xlsx network tabs) or manual admin entry.
 */
import { ilike, pharmacies, type Db } from "@rxsr/db";
import type { PharmacyCandidate } from "@rxsr/core/pharmacy";

type PharmacyRow = typeof pharmacies.$inferSelect;

export const candidateFromPharmacyRow = (row: PharmacyRow): PharmacyCandidate => ({
  id: row.id,
  npi: row.npi,
  name: row.name,
  altNames: row.altNames,
  address1: row.address1,
  city: row.city,
  state: row.state,
  zip: row.zip,
});

/**
 * Candidates from the ZIP *area* (same USPS 3-digit prefix ≈ same metro),
 * not just the exact ZIP: RxC forms search "within 15 miles", so the right
 * pharmacy often sits in a neighboring ZIP. The scorer keeps exact-ZIP
 * candidates on top (ZIP agreement is worth 0.35 of the score), and
 * cross-ZIP name-only matches stay below the auto-confirm threshold — they
 * link amber for agent confirmation instead of silently winning.
 */
export async function loadZipCandidates(
  db: Db,
  zip: string,
): Promise<PharmacyRow[]> {
  const prefix = zip.slice(0, 3);
  return db.select().from(pharmacies).where(ilike(pharmacies.zip, `${prefix}%`));
}
