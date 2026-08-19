/**
 * Server-only route helper for the carrier network manager: pharmacies by
 * ZIP plus each one's status on the CARRIER's network (+ verifier name).
 * Read-only. Never import from client code.
 */
import { and, asc, carrierPharmacyNetworks, desc, eq, getDb, inArray, ingestionJobs, pharmacies, pharmacyBrands, profiles, sql } from "@rxsr/db";
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

export interface DirectoryJobStatus {
  status: string;
  message: string | null;
  error: string | null;
}

/** Latest carrier-directory ingest job — powers the network section's progress line. */
export async function getLatestDirectoryJob(
  carrierId: string,
): Promise<DirectoryJobStatus | null> {
  const db = getDb();
  const [job] = await db
    .select({
      status: ingestionJobs.status,
      message: sql<string | null>`${ingestionJobs.progress} ->> 'message'`,
      error: ingestionJobs.error,
    })
    .from(ingestionJobs)
    .where(and(eq(ingestionJobs.kind, "pharmacy_directory"), eq(ingestionJobs.targetId, carrierId)))
    .orderBy(desc(ingestionJobs.createdAt))
    .limit(1);
  return job ?? null;
}

/** Rows on a carrier's network for one plan year (unstaged). */
export async function getCarrierNetworkCount(
  carrierId: string,
  planYear: number,
): Promise<number> {
  const db = getDb();
  const [row] = await db
    .select({ value: sql<number>`count(*)::int` })
    .from(carrierPharmacyNetworks)
    .where(
      and(
        eq(carrierPharmacyNetworks.carrierId, carrierId),
        eq(carrierPharmacyNetworks.planYear, planYear),
        eq(carrierPharmacyNetworks.staged, false),
      ),
    );
  return row?.value ?? 0;
}

export interface CarrierNetworkEditorRow {
  pharmacyId: string;
  name: string;
  brandName: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  status: "preferred" | "standard" | "out_of_network";
  source: string;
  verifiedByName: string | null;
  verifiedAt: string | null;
}

/** The full (unstaged) network of one carrier for one plan year. */
export async function getCarrierNetworkRows(
  carrierId: string,
  planYear: number,
): Promise<CarrierNetworkEditorRow[]> {
  const db = getDb();
  const rows = await db
    .select({
      pharmacyId: carrierPharmacyNetworks.pharmacyId,
      name: pharmacies.name,
      brandName: pharmacyBrands.name,
      city: pharmacies.city,
      state: pharmacies.state,
      zip: pharmacies.zip,
      status: carrierPharmacyNetworks.status,
      source: carrierPharmacyNetworks.source,
      verifiedByName: profiles.fullName,
      verifiedAt: carrierPharmacyNetworks.verifiedAt,
    })
    .from(carrierPharmacyNetworks)
    .innerJoin(pharmacies, eq(carrierPharmacyNetworks.pharmacyId, pharmacies.id))
    .leftJoin(pharmacyBrands, eq(pharmacies.brandId, pharmacyBrands.id))
    .leftJoin(profiles, eq(carrierPharmacyNetworks.verifiedBy, profiles.id))
    .where(
      and(
        eq(carrierPharmacyNetworks.carrierId, carrierId),
        eq(carrierPharmacyNetworks.planYear, planYear),
        eq(carrierPharmacyNetworks.staged, false),
      ),
    )
    .orderBy(asc(pharmacies.name))
    .limit(5000);
  return rows.map((row) => ({
    ...row,
    verifiedAt: row.verifiedAt ? row.verifiedAt.toISOString() : null,
  }));
}
