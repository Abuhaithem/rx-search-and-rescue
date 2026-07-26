/**
 * Server-only route helper. No pharmacies query exists under src/server/queries,
 * so the plan-catalog override affordance searches the pharmacies reference
 * table directly (plus the plan's network row + verifier name). Read-only.
 * Never import from client code.
 */
import { and, asc, eq, getDb, inArray, pharmacies, planPharmacyNetworks, profiles } from "@rxsr/db";
import type { NetworkStatus } from "@rxsr/core";

export interface PharmacyZipRow {
  id: string;
  name: string;
  address1: string | null;
  city: string | null;
  zip: string | null;
  status: NetworkStatus | null;
  verifiedByName: string | null;
}

export async function searchPharmaciesByZip(zip: string, planId: string): Promise<PharmacyZipRow[]> {
  const db = getDb();
  const rows = await db
    .select({
      id: pharmacies.id,
      name: pharmacies.name,
      address1: pharmacies.address1,
      city: pharmacies.city,
      zip: pharmacies.zip,
    })
    .from(pharmacies)
    .where(eq(pharmacies.zip, zip))
    .orderBy(asc(pharmacies.name))
    .limit(25);
  if (rows.length === 0) return [];

  const networkRows = await db
    .select({
      pharmacyId: planPharmacyNetworks.pharmacyId,
      status: planPharmacyNetworks.status,
      verifiedByName: profiles.fullName,
    })
    .from(planPharmacyNetworks)
    .leftJoin(profiles, eq(planPharmacyNetworks.verifiedBy, profiles.id))
    .where(
      and(
        eq(planPharmacyNetworks.planId, planId),
        inArray(
          planPharmacyNetworks.pharmacyId,
          rows.map((r) => r.id),
        ),
      ),
    );
  const byPharmacy = new Map(networkRows.map((r) => [r.pharmacyId, r]));

  return rows.map((row) => {
    const network = byPharmacy.get(row.id);
    return {
      ...row,
      status: network?.status ?? null,
      verifiedByName: network?.verifiedByName ?? null,
    };
  });
}
