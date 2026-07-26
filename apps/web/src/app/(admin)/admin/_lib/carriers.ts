/**
 * Server-only route helper. No carriers query exists under src/server/queries,
 * so the admin screens read the carriers reference table directly. Read-only.
 * Never import from client code.
 */
import { asc, carriers, getDb } from "@rxsr/db";

export interface CarrierOption {
  id: string;
  name: string;
}

export async function listCarriers(): Promise<CarrierOption[]> {
  const db = getDb();
  return db
    .select({ id: carriers.id, name: carriers.name })
    .from(carriers)
    .orderBy(asc(carriers.name));
}
