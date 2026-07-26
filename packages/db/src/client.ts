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
  // max is deliberately small: Supabase's session pooler caps total clients
  // (15 on the base tier), and Next.js dev can instantiate several pools.
  const client = postgres(url, { prepare: false, max: 4, idle_timeout: 30 });
  return drizzle(client, { schema });
}

/**
 * Lazily-created singleton for app/server usage. Cached on globalThis so
 * Next.js dev-mode bundle duplication and hot reloads reuse one pool instead
 * of exhausting the session pooler's client limit.
 */
export function getDb(): Db {
  const g = globalThis as typeof globalThis & { __rxsrDb?: Db };
  g.__rxsrDb ??= createDb();
  return g.__rxsrDb;
}
