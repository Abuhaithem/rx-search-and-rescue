import "./load-env";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const dir = path.dirname(fileURLToPath(import.meta.url));
const client = postgres(url, { max: 1, prepare: false });
const db = drizzle(client);

await migrate(db, { migrationsFolder: path.join(dir, "../migrations") });

// Apply Supabase-specific SQL (RLS policies, auth trigger) — idempotent.
const rls = readFileSync(path.join(dir, "../supabase/rls.sql"), "utf8");
await client.unsafe(rls);

console.log("migrations + RLS applied");
await client.end();
