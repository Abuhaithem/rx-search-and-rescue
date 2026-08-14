"use server";

import { z } from "zod";
import { and, asc, eq, ilike, or } from "drizzle-orm";
import { getDb, pharmacies } from "@rxsr/db";
import { err, errorMessage, ok, type ActionResult } from "../action-result";
import { requireRole } from "../auth";

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
 * With a client ZIP the results are scoped to that ZIP only.
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
      .where(zip ? and(eq(pharmacies.zip, zip), textMatch) : textMatch)
      .orderBy(asc(pharmacies.name))
      .limit(20);
    return ok(rows);
  } catch (e) {
    return err(errorMessage(e));
  }
}
