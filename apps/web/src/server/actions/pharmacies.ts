"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { and, asc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { clientPharmacies, getDb, pharmacies, pharmacyBrands } from "@rxsr/db";
import { err, errorMessage, ok, type ActionResult } from "../action-result";
import { requireRole } from "../auth";
import { writeAudit } from "../audit";
import { uploadObject } from "../storage";
import { enqueueIngestionJob, QUEUE_NAMES } from "../enqueue";

export interface PharmacySearchHit {
  id: string;
  name: string;
  address1: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
}

const querySchema = z.string().trim().min(2).max(80);

const zipSchema = z
  .string()
  .regex(/^\d{5}$/)
  .nullish();

/**
 * Read-only search behind the pharmacy combobox — no audit row needed.
 * Never excludes by ZIP (the right pharmacy is often one town over) — with a
 * client ZIP, same-ZIP hits rank first and the UI badges in/out of ZIP.
 */
export async function searchPharmacies(
  query: string,
  clientZip?: string | null,
): Promise<ActionResult<PharmacySearchHit[]>> {
  try {
    await requireRole();
    const q = querySchema.parse(query);
    const zip = zipSchema.parse(clientZip ?? null);
    const pattern = `%${q}%`;
    const textMatch = or(
      ilike(pharmacies.name, pattern),
      ilike(pharmacies.city, pattern),
      ilike(pharmacies.zip, pattern),
    );
    const rows = await getDb()
      .select({
        id: pharmacies.id,
        name: pharmacies.name,
        address1: pharmacies.address1,
        city: pharmacies.city,
        state: pharmacies.state,
        zip: pharmacies.zip,
      })
      .from(pharmacies)
      .where(textMatch)
      .orderBy(
        ...(zip ? [sql`case when ${pharmacies.zip} = ${zip} then 0 else 1 end`] : []),
        asc(pharmacies.name),
      )
      .limit(20);
    return ok(rows);
  } catch (e) {
    return err(errorMessage(e));
  }
}

const importRowSchema = z.object({
  /** Storefront name as printed, store # included ("Walgreens #5841"). */
  name: z.string().trim().min(2).max(200),
  address1: z.string().trim().max(200).nullable(),
  city: z.string().trim().max(100).nullable(),
  zip: z.string().regex(/^\d{5}$/),
  /**
   * Chain/brand the location belongs to. Prefilled by derivation in the UI,
   * editable so families like Albertsons/Sav-On can share one brand.
   */
  brand: z.string().trim().min(2).max(200),
});
export type PharmacyImportRow = z.infer<typeof importRowSchema>;

const importSchema = z.object({
  state: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2}$/),
  rows: z.array(importRowSchema).min(1).max(2000),
});

/**
 * The master pharmacy list, pasted as a table. Upserts into the pharmacies
 * table — the single source every network, picker, and match runs against.
 * Identity is name+ZIP: re-pasting an updated list refreshes addresses
 * instead of duplicating rows.
 */
export async function importPharmacyList(
  state: string,
  rows: PharmacyImportRow[],
): Promise<ActionResult<{ inserted: number; updated: number }>> {
  try {
    const profile = await requireRole("admin", "manager");
    const input = importSchema.parse({ state, rows });

    // Last occurrence wins within the pasted list itself.
    const byKey = new Map<string, PharmacyImportRow>();
    for (const row of input.rows) {
      byKey.set(`${row.name.toLowerCase()}|${row.zip}`, row);
    }
    const uniqueRows = [...byKey.values()];

    const db = getDb();
    const existing = await db
      .select({ id: pharmacies.id, name: pharmacies.name, zip: pharmacies.zip })
      .from(pharmacies)
      .where(
        and(
          eq(pharmacies.state, input.state),
          inArray(pharmacies.zip, [...new Set(uniqueRows.map((r) => r.zip))]),
        ),
      );
    const existingByKey = new Map(
      existing.map((row) => [`${row.name.toLowerCase()}|${row.zip}`, row.id]),
    );

    let inserted = 0;
    let updated = 0;
    await db.transaction(async (tx) => {
      // Get-or-create every brand the pasted rows name, in one round trip.
      const brandNames = new Map<string, string>(); // normalized → display
      for (const row of uniqueRows) {
        brandNames.set(row.brand.toLowerCase(), row.brand);
      }
      const normalizedNames = [...brandNames.keys()];
      const existingBrands = await tx
        .select({ id: pharmacyBrands.id, normalizedName: pharmacyBrands.normalizedName })
        .from(pharmacyBrands)
        .where(inArray(pharmacyBrands.normalizedName, normalizedNames));
      const brandIdByNormalized = new Map(
        existingBrands.map((b) => [b.normalizedName, b.id]),
      );
      const missing = normalizedNames.filter((n) => !brandIdByNormalized.has(n));
      if (missing.length > 0) {
        const insertedBrands = await tx
          .insert(pharmacyBrands)
          .values(missing.map((n) => ({ name: brandNames.get(n)!, normalizedName: n })))
          .returning({ id: pharmacyBrands.id, normalizedName: pharmacyBrands.normalizedName });
        for (const b of insertedBrands) brandIdByNormalized.set(b.normalizedName, b.id);
      }

      const toInsert: (typeof pharmacies.$inferInsert)[] = [];
      for (const row of uniqueRows) {
        const brandId = brandIdByNormalized.get(row.brand.toLowerCase()) ?? null;
        const existingId = existingByKey.get(`${row.name.toLowerCase()}|${row.zip}`);
        if (existingId) {
          await tx
            .update(pharmacies)
            .set({
              address1: row.address1,
              city: row.city,
              state: input.state,
              brandId,
            })
            .where(eq(pharmacies.id, existingId));
          updated += 1;
        } else {
          toInsert.push({
            name: row.name,
            brandId,
            address1: row.address1,
            city: row.city,
            state: input.state,
            zip: row.zip,
            source: "list",
          });
        }
      }
      if (toInsert.length > 0) {
        await tx.insert(pharmacies).values(toInsert);
        inserted = toInsert.length;
      }
      await writeAudit(tx, {
        actorId: profile.id,
        action: "pharmacy.list_imported",
        entityType: "pharmacy_list",
        meta: { state: input.state, inserted, updated },
      });
    });

    revalidatePath("/", "layout");
    return ok({ inserted, updated });
  } catch (e) {
    return err(errorMessage(e));
  }
}

const MAX_ROSTER_BYTES = 25 * 1024 * 1024;

/**
 * formData: pdf — a statewide pharmacy roster. The worker extracts active
 * locations (AI at ingestion time) and upserts them into the master list.
 */
export async function uploadPharmacyRoster(
  state: string,
  formData: FormData,
): Promise<ActionResult<{ ingestionJobId: string }>> {
  try {
    const profile = await requireRole("admin", "manager");
    const stateCode = z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{2}$/)
      .parse(state);

    const file = formData.get("pdf") ?? formData.get("file");
    if (!(file instanceof File) || file.size === 0) throw new Error("A PDF file is required");
    const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
    if (!isPdf) throw new Error("Only PDF files are accepted");
    if (file.size > MAX_ROSTER_BYTES) throw new Error("PDF exceeds the 25 MB limit");

    const storagePath = `pharmacy-rosters/${randomUUID()}.pdf`;
    await uploadObject(storagePath, new Uint8Array(await file.arrayBuffer()), "application/pdf");

    const { ingestionJobId } = await enqueueIngestionJob({
      kind: "pharmacy_roster",
      queue: QUEUE_NAMES.pharmacyRoster,
      payload: (jobId) => ({ ingestionJobId: jobId, storagePath, state: stateCode }),
    });

    await writeAudit(getDb(), {
      actorId: profile.id,
      action: "pharmacy.roster_uploaded",
      entityType: "pharmacy_list",
      meta: { state: stateCode, fileName: file.name, storagePath, ingestionJobId },
    });

    revalidatePath("/", "layout");
    return ok({ ingestionJobId });
  } catch (e) {
    return err(errorMessage(e));
  }
}

const pharmacyUuidSchema = z.string().uuid();

const pharmacyPatchSchema = z.object({
  name: z.string().trim().min(2).max(200),
  /** Brand display name; created on first use. */
  brand: z.string().trim().min(2).max(200),
  address1: z.string().trim().max(200).nullable(),
  city: z.string().trim().max(100).nullable(),
  state: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2}$/)
    .nullable(),
  zip: z
    .string()
    .regex(/^\d{5}$/)
    .nullable(),
});
export type PharmacyPatch = z.infer<typeof pharmacyPatchSchema>;

export async function updatePharmacy(
  pharmacyId: string,
  patch: PharmacyPatch,
): Promise<ActionResult<{ pharmacyId: string }>> {
  try {
    const profile = await requireRole("admin", "manager");
    pharmacyUuidSchema.parse(pharmacyId);
    const input = pharmacyPatchSchema.parse(patch);

    const db = getDb();
    await db.transaction(async (tx) => {
      const normalizedBrand = input.brand.toLowerCase();
      const [existingBrand] = await tx
        .select({ id: pharmacyBrands.id })
        .from(pharmacyBrands)
        .where(eq(pharmacyBrands.normalizedName, normalizedBrand))
        .limit(1);
      let brandId = existingBrand?.id ?? null;
      if (!brandId) {
        const [insertedBrand] = await tx
          .insert(pharmacyBrands)
          .values({ name: input.brand, normalizedName: normalizedBrand })
          .returning({ id: pharmacyBrands.id });
        brandId = insertedBrand?.id ?? null;
      }

      const [updated] = await tx
        .update(pharmacies)
        .set({
          name: input.name,
          brandId,
          address1: input.address1,
          city: input.city,
          state: input.state,
          zip: input.zip,
        })
        .where(eq(pharmacies.id, pharmacyId))
        .returning({ id: pharmacies.id });
      if (!updated) throw new Error("Pharmacy not found");

      await writeAudit(tx, {
        actorId: profile.id,
        action: "pharmacy.updated",
        entityType: "pharmacy",
        entityId: pharmacyId,
        meta: { patch: input },
      });
    });

    revalidatePath("/", "layout");
    return ok({ pharmacyId });
  } catch (e) {
    return err(errorMessage(e));
  }
}

/**
 * Remove one location from the master list. Carrier/plan network rows
 * cascade away; client links become unlinked raw text again (the client
 * record itself is untouched).
 */
export async function deletePharmacy(
  pharmacyId: string,
): Promise<ActionResult<{ pharmacyId: string }>> {
  try {
    const profile = await requireRole("admin", "manager");
    pharmacyUuidSchema.parse(pharmacyId);

    const db = getDb();
    const [row] = await db
      .select({ id: pharmacies.id, name: pharmacies.name, zip: pharmacies.zip })
      .from(pharmacies)
      .where(eq(pharmacies.id, pharmacyId))
      .limit(1);
    if (!row) return err("Pharmacy not found");

    await db.transaction(async (tx) => {
      await tx
        .update(clientPharmacies)
        .set({ pharmacyId: null, confirmed: false })
        .where(eq(clientPharmacies.pharmacyId, pharmacyId));
      await tx.delete(pharmacies).where(eq(pharmacies.id, pharmacyId));
      await writeAudit(tx, {
        actorId: profile.id,
        action: "pharmacy.deleted",
        entityType: "pharmacy",
        entityId: pharmacyId,
        meta: { name: row.name, zip: row.zip },
      });
    });

    revalidatePath("/", "layout");
    return ok({ pharmacyId });
  } catch (e) {
    return err(errorMessage(e));
  }
}
