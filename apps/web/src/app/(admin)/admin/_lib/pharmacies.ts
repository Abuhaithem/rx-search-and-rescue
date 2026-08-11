/**
 * Server-only route helper for the carrier network manager: pharmacies by
 * ZIP plus each one's status on the CARRIER's network (+ verifier name).
 * Read-only. Never import from client code.
 */
import { and, asc, carrierPharmacyNetworks, eq, getDb, inArray, pharmacies, profiles } from "@rxsr/db";
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

export async function searchPharmaciesByZip(zip: string, carrierId: string, planYear: number): Promise<PharmacyZipRow[]> {
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
      pharmacyId: carrierPharmacyNetworks.pharmacyId,
      status: carrierPharmacyNetworks.status,
      verifiedByName: profiles.fullName,
    })
    .from(carrierPharmacyNetworks)
    .leftJoin(profiles, eq(carrierPharmacyNetworks.verifiedBy, profiles.id))
    .where(
      and(
        eq(carrierPharmacyNetworks.carrierId, carrierId),
        eq(carrierPharmacyNetworks.planYear, planYear),
        eq(carrierPharmacyNetworks.staged, false),
        inArray(
          carrierPharmacyNetworks.pharmacyId,
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
