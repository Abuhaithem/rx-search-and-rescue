/**
 * Shared pharmacy-resolution plumbing for intake and directory jobs. The
 * pharmacies table is the only candidate source — rows enter it from carrier
 * files (pharmacy directories, xlsx network tabs) or manual admin entry.
 */
import { eq, pharmacies, type Db } from "@rxsr/db";
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

export async function loadZipCandidates(
  db: Db,
  zip: string,
): Promise<PharmacyRow[]> {
  return db.select().from(pharmacies).where(eq(pharmacies.zip, zip));
}
