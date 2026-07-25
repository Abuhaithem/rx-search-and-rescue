import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export type Db = ReturnType<typeof createDb>;

/**
 * Creates a Drizzle client over a single postgres-js connection pool.
 * Supabase: use the pooled (transaction-mode) connection string in serverless
 * contexts and the direct string in the worker. `prepare: false` is required
 * for transaction-mode pooling (PgBouncer).
 */
export function createDb(url = process.env.DATABASE_URL) {
  if (!url) throw new Error("DATABASE_URL is not set");
  const client = postgres(url, { prepare: false, max: 10 });
  return drizzle(client, { schema });
}

let cached: Db | undefined;

/** Lazily-created singleton for app/server usage. */
export function getDb(): Db {
  cached ??= createDb();
  return cached;
}
