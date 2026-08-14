/**
 * Shared pharmacy-resolution plumbing for intake and directory jobs. The
 * pharmacies table is the only candidate source — rows enter it from carrier
 * files (pharmacy directories, xlsx network tabs) or manual admin entry.
 */
import { eq, ilike, pharmacies, pharmacyBrands, type Db } from "@rxsr/db";
import {
  derivePharmacyBrandName,
  normalizePharmacyBrandName,
  type PharmacyCandidate,
} from "@rxsr/core/pharmacy";

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

/**
 * Prompt for the LLM pharmacy-resolution fallback. Contains only the
 * pharmacy free text and DB candidates — no client identity, so nothing
 * PHI-shaped leaves with it.
 */
export function pharmacyResolutionPrompt(
  rawText: string,
  zipHint: string,
  candidates: PharmacyCandidate[],
): string {
  const lines = candidates.map((c, index) => {
    const parts = [c.name, c.address1, c.city, c.state, c.zip].filter(Boolean);
    return `${index}. ${parts.join(", ")}`;
  });
  return [
    `The client wrote this pharmacy on a form: "${rawText}"`,
    `Client area ZIP: ${zipHint}`,
    "",
    "Known pharmacies nearby:",
    ...lines,
  ].join("\n");
}

/**
 * Get-or-create the brand row for a location name. onConflictDoNothing +
 * re-select keeps concurrent ingest workers race-safe.
 */
export async function ensureBrandId(db: Db, pharmacyName: string): Promise<string | null> {
  const normalized = normalizePharmacyBrandName(pharmacyName);
  if (normalized === "") return null;
  const [existing] = await db
    .select({ id: pharmacyBrands.id })
    .from(pharmacyBrands)
    .where(eq(pharmacyBrands.normalizedName, normalized))
    .limit(1);
  if (existing) return existing.id;
  const [inserted] = await db
    .insert(pharmacyBrands)
    .values({ name: derivePharmacyBrandName(pharmacyName), normalizedName: normalized })
    .onConflictDoNothing()
    .returning({ id: pharmacyBrands.id });
  if (inserted) return inserted.id;
  const [raced] = await db
    .select({ id: pharmacyBrands.id })
    .from(pharmacyBrands)
    .where(eq(pharmacyBrands.normalizedName, normalized))
    .limit(1);
  return raced?.id ?? null;
}
