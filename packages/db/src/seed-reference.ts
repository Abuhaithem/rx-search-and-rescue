/**
 * Reference-data seed — IDEMPOTENT UPSERTS ONLY, never deletes; safe to run
 * against a live database at any time.
 *   - carriers for the 2026 document set (upsert by slug; any other carriers,
 *     e.g. "Pacific Source" from the demo seed, are left untouched)
 *   - zip_counties for all of Idaho from the Census 2020 ZCTA↔county
 *     relationship file (public domain). ZCTA ≈ ZIP is an approximation;
 *     acceptable because the intake screen makes the county agent-confirmable.
 * Formularies, plans, tier costs, and pharmacy networks are NEVER seeded —
 * they flow through the real ingestion pipeline for provenance + QA.
 */
import "./load-env";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createDb } from "./client";
import * as s from "./schema";
import { parseZctaCountyRelationship } from "./census-zcta";

const CENSUS_ZCTA_URL =
  "https://www2.census.gov/geo/docs/maps-data/data/rel2020/zcta520/tab20_zcta520_county20_natl.txt";
// Cached (gitignored) so re-runs are offline; delete the file to force refresh.
const CACHE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", ".cache");
const CACHE_PATH = path.join(CACHE_DIR, "tab20_zcta520_county20_natl.txt");

const REFERENCE_CARRIERS = [
  { name: "UnitedHealthcare", slug: "uhc" },
  { name: "Humana", slug: "humana" },
  { name: "Blue Cross of Idaho", slug: "bci" },
  { name: "Cigna", slug: "cigna" },
  { name: "Molina", slug: "molina" },
  { name: "WellCare", slug: "wellcare" },
  { name: "SilverScript", slug: "silverscript" },
];

async function loadCensusText(fetchImpl: typeof fetch = fetch): Promise<string> {
  if (existsSync(CACHE_PATH)) return readFileSync(CACHE_PATH, "utf8");
  console.log(`downloading ${CENSUS_ZCTA_URL} (national file, ~100MB — one time)…`);
  const res = await fetchImpl(CENSUS_ZCTA_URL);
  if (!res.ok) {
    throw new Error(`Census ZCTA relationship download failed: HTTP ${res.status}`);
  }
  const text = await res.text();
  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(CACHE_PATH, text);
  return text;
}

const db = createDb();

for (const carrier of REFERENCE_CARRIERS) {
  await db
    .insert(s.carriers)
    .values(carrier)
    .onConflictDoUpdate({ target: s.carriers.slug, set: { name: carrier.name } });
}
console.log(`carriers upserted: ${REFERENCE_CARRIERS.map((c) => c.slug).join(", ")}`);

const zipRows = parseZctaCountyRelationship(await loadCensusText(), {
  stateFipsPrefix: "16",
  state: "ID",
});
const BATCH = 500;
for (let i = 0; i < zipRows.length; i += BATCH) {
  await db
    .insert(s.zipCounties)
    .values(zipRows.slice(i, i + BATCH))
    .onConflictDoNothing();
}
console.log(`zip_counties upserted: ${zipRows.length} Idaho ZCTA↔county rows`);

console.log("reference seed complete");
process.exit(0);
