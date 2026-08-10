"use server";

import { z } from "zod";
import { asc, ilike, or } from "drizzle-orm";
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

/** Read-only search behind the pharmacy combobox — no audit row needed. */
export async function searchPharmacies(
  query: string,
): Promise<ActionResult<PharmacySearchHit[]>> {
  try {
    await requireRole();
    const q = querySchema.parse(query);
    const pattern = `%${q}%`;
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
      .where(
        or(
          ilike(pharmacies.name, pattern),
          ilike(pharmacies.city, pattern),
          ilike(pharmacies.zip, pattern),
        ),
      )
      .orderBy(asc(pharmacies.name))
      .limit(20);
    return ok(rows);
  } catch (e) {
    return err(errorMessage(e));
  }
}
