/**
 * Removes the data seed-demo inserts. GUARDED: without the literal "--yes"
 * argument it only prints what it would delete.
 *   pnpm db:wipe:demo -- --yes
 * Deletes: ALL client-domain rows (clients, medications, client pharmacies,
 * policies, analyses, results, overrides — dev-only PHI shapes), the demo
 * plans (matched by their seed-demo names; plan cascades cover service areas,
 * tier costs, pharmacy networks), demo formularies (sourceFilePath IS NULL —
 * pipeline-ingested formularies always carry a Storage path), and the two
 * seed-demo pharmacies (matched by name + source "manual").
 * Keeps: carriers, zip_counties, profiles, audit_events, and everything
 * created by the real ingestion pipeline.
 */
import "./load-env";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { createDb } from "./client";
import * as s from "./schema";

const DEMO_PLAN_NAMES = [
  "UHC Plan 0009",
  "True Blue Rx 33 (HMO)",
  "MyCare 24",
  "Humana Basic Rx",
];
const DEMO_PHARMACY_NAMES = ["Valley Apothecary", "The Drug Store"];

const confirmed = process.argv.includes("--yes");
const db = createDb();

const demoPlansWhere = inArray(s.plans.name, DEMO_PLAN_NAMES);
const demoFormulariesWhere = isNull(s.formularies.sourceFilePath);
const demoPharmaciesWhere = and(
  inArray(s.pharmacies.name, DEMO_PHARMACY_NAMES),
  eq(s.pharmacies.source, "manual"),
);

const counts: Array<[label: string, count: number]> = [
  ["report_overrides", await db.$count(s.reportOverrides)],
  ["analysis_results", await db.$count(s.analysisResults)],
  ["analysis_plans", await db.$count(s.analysisPlans)],
  ["analyses", await db.$count(s.analyses)],
  ["in_force_policies", await db.$count(s.inForcePolicies)],
  ["client_medications", await db.$count(s.clientMedications)],
  ["client_pharmacies", await db.$count(s.clientPharmacies)],
  ["clients", await db.$count(s.clients)],
  ["plans (demo, + cascaded areas/costs/networks)", await db.$count(s.plans, demoPlansWhere)],
  ["formularies (demo, + cascaded entries/legends)", await db.$count(s.formularies, demoFormulariesWhere)],
  ["pharmacies (demo)", await db.$count(s.pharmacies, demoPharmaciesWhere)],
];

console.log(confirmed ? "Deleting demo data:" : "DRY RUN — would delete:");
for (const [label, count] of counts) {
  console.log(`  ${String(count).padStart(6)}  ${label}`);
}
console.log("Kept: carriers, zip_counties, profiles, audit_events, ingested formularies.");

if (!confirmed) {
  console.log('\nNothing deleted. Re-run with "--yes" to delete:');
  console.log("  pnpm db:wipe:demo -- --yes");
  process.exit(0);
}

await db.delete(s.reportOverrides);
await db.delete(s.analysisResults);
await db.delete(s.analysisPlans);
await db.delete(s.analyses);
await db.delete(s.inForcePolicies);
await db.delete(s.clientMedications);
await db.delete(s.clientPharmacies);
await db.delete(s.clients);
// Order matters: plans reference formularies (no cascade on plans.formularyId).
await db.delete(s.plans).where(demoPlansWhere);
await db.delete(s.formularies).where(demoFormulariesWhere);
await db.delete(s.pharmacies).where(demoPharmaciesWhere);

console.log("demo wipe complete");
process.exit(0);
