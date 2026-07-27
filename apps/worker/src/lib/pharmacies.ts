/**
 * Shared pharmacy-resolution plumbing for intake and directory jobs:
 * merge DB rows with NPPES candidates, and materialize a pharmacies row for a
 * matched NPPES candidate that isn't imported yet.
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

export interface CandidatePool {
  candidates: PharmacyCandidate[];
  /** pharmacies.id values already in the DB (vs NPPES-only candidates). */
  dbIds: Set<string>;
}

/** DB rows win over NPPES duplicates (matched by NPI). */
export function mergeCandidates(
  dbRows: PharmacyRow[],
  nppesCandidates: PharmacyCandidate[],
): CandidatePool {
  const dbCandidates = dbRows.map(candidateFromPharmacyRow);
  const knownNpis = new Set(dbRows.map((r) => r.npi).filter((n): n is string => n !== null));
  const merged = [
    ...dbCandidates,
    ...nppesCandidates.filter((c) => c.npi === null || !knownNpis.has(c.npi)),
  ];
  return { candidates: merged, dbIds: new Set(dbCandidates.map((c) => c.id)) };
}

/** Returns a pharmacies.id for the candidate, importing NPPES rows on demand. */
export async function ensurePharmacyId(
  db: Db,
  candidate: PharmacyCandidate,
  pool: CandidatePool,
): Promise<string> {
  if (pool.dbIds.has(candidate.id)) return candidate.id;
  if (candidate.npi === null) {
    throw new Error(`Cannot import pharmacy candidate without an NPI: ${candidate.name}`);
  }
  const rows = await db
    .insert(pharmacies)
    .values({
      npi: candidate.npi,
      name: candidate.name,
      altNames: candidate.altNames ?? [],
      address1: candidate.address1,
      city: candidate.city,
      state: candidate.state,
      zip: candidate.zip,
      source: "nppes",
    })
    .onConflictDoUpdate({
      target: pharmacies.npi,
      set: {
        name: candidate.name,
        altNames: candidate.altNames ?? [],
        address1: candidate.address1,
        city: candidate.city,
        state: candidate.state,
        zip: candidate.zip,
      },
    })
    .returning({ id: pharmacies.id });
  const row = rows[0];
  if (!row) throw new Error(`Pharmacy upsert returned no row for NPI ${candidate.npi}`);
  return row.id;
}

export async function loadZipCandidates(
  db: Db,
  zip: string,
): Promise<PharmacyRow[]> {
  return db.select().from(pharmacies).where(eq(pharmacies.zip, zip));
}
