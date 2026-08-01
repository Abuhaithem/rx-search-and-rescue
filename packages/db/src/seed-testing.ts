/**
 * Real-data testing seed. Uses genuine 2026 data for two plans:
 *   • Blue Cross of Idaho — True Blue Rx 33 (HMO), H1350-033
 *   • Humana — Value Rx Plan (PDP), S5884-210
 * Formulary tiers are taken from each carrier's 2026 formulary list; tier
 * cost-sharing from each plan's 2026 Summary of Benefits. Clients are the three
 * real AgencyBloc RxC exports (Healy / Smith / Gonzalez) so the pipeline can be
 * tested end to end.
 *
 * Deliberate "missing data" cases (the app must handle these gracefully):
 *   • Gregory's current drug plan is WellCare (not seeded) → matched_plan_id null.
 *   • Gregory & Felix listed no preferred pharmacy → cost matrix has no retail row.
 *   • Cortef (hydrocortisone tablet) is off Humana's formulary → not_on_formulary.
 *   • Lamotrigine ER matches True Blue's non-ER row only fuzzily → needs confirmation.
 *   • Albertsons has no True Blue network row → status assumed (amber).
 *
 * Only 2026 is seeded (the only plan year we have documents for).
 * Idempotent: wipes and re-inserts. Never run against production.
 */
import "./load-env";
import { createDb } from "./client";
import * as s from "./schema";

const db = createDb();
const YEAR = 2026;

// ── wipe (children first) ────────────────────────────────────────────────────
await db.delete(s.reportOverrides);
await db.delete(s.analysisResults);
await db.delete(s.analysisPharmacies);
await db.delete(s.analysisPlans);
await db.delete(s.analyses);
await db.delete(s.inForcePolicies);
await db.delete(s.clientMedications);
await db.delete(s.clientPharmacies);
await db.delete(s.clients);
await db.delete(s.planPharmacyNetworks);
await db.delete(s.pharmacies);
await db.delete(s.planTierCosts);
await db.delete(s.planServiceAreas);
await db.delete(s.plans);
await db.delete(s.formularyLegends);
await db.delete(s.formularyEntries);
await db.delete(s.formularies);
await db.delete(s.carriers);
await db.delete(s.zipCounties);

// ── carriers ─────────────────────────────────────────────────────────────────
const [bci, humana] = await db
  .insert(s.carriers)
  .values([
    { name: "Blue Cross of Idaho", slug: "bci" },
    { name: "Humana", slug: "humana" },
  ])
  .returning();

// ── ZIP → county (Blaine County test ZIPs from the RxC exports) ─────────────
await db.insert(s.zipCounties).values([
  { zip: "83333", state: "ID", county: "Blaine" }, // Hailey
  { zip: "83340", state: "ID", county: "Blaine" }, // Ketchum
]);

// ── formularies ──────────────────────────────────────────────────────────────
const [fTrueBlue, fHumanaValue] = await db
  .insert(s.formularies)
  .values([
    {
      carrierId: bci!.id,
      planYear: YEAR,
      label: "2026 True Blue Rx (all True Blue plans)",
      formularyCode: "00026046 V08",
      versionDate: "01/01/2026",
      status: "active" as const,
    },
    {
      carrierId: humana!.id,
      planYear: YEAR,
      label: "2026 Humana Value Rx Plan (PDP) formulary",
      versionDate: "01/01/2026",
      status: "active" as const,
    },
  ])
  .returning();

// ── formulary entries (real tiers from each 2026 formulary list) ────────────
type EntryOpts = Partial<typeof s.formularyEntries.$inferInsert>;
type EntryRow = [rawDrugName: string, normalizedName: string, tier: number, opts?: EntryOpts];

const mkEntries = (formularyId: string, rows: EntryRow[]) =>
  rows.map(([rawDrugName, normalizedName, tier, opts], i) => ({
    formularyId,
    rawDrugName,
    normalizedName,
    tier,
    sourcePage: 10 + i,
    ...opts,
  }));

const ql = (quantity: number, days: number): EntryOpts => ({ qlQuantity: quantity, qlDays: days });

await db.insert(s.formularyEntries).values([
  // ── True Blue Rx formulary ────────────────────────────────────────────────
  ...mkEntries(fTrueBlue!.id, [
    ["atorvastatin calcium oral tablet 10 mg, 20 mg, 40 mg, 80 mg",
      "atorvastatin calcium oral tablet 20 mg", 1, ql(30, 30)],
    ["diltiazem hcl er beads oral capsule extended release 24 hour",
      "diltiazem hcl er oral capsule extended release 24 hour 240 mg", 3],
    ["ELIQUIS", "eliquis 2.5 mg, 5 mg tablet", 3, { isBrand: true, ...ql(60, 30) }],
    ["losartan potassium oral tablet 25 mg, 50 mg",
      "losartan potassium oral tablet 25 mg 50 mg", 1, ql(60, 30)],
    ["metoprolol succinate er oral tablet extended release 24 hour 25 mg, 50 mg, 100 mg, 200 mg",
      "metoprolol succinate er oral tablet extended release 24 hour 50 mg", 2],
    ["sertraline hcl oral tablet 100 mg", "sertraline hcl oral tablet 100 mg", 1, ql(60, 30)],
    ["amiodarone hcl oral tablet 100 mg, 200 mg",
      "amiodarone hcl oral tablet 100 mg 200 mg", 2],
    ["carvedilol oral tablet 3.125 mg, 6.25 mg, 12.5 mg, 25 mg",
      "carvedilol oral tablet 3.125 mg", 1],
    ["lisinopril-hydrochlorothiazide oral tablet 20-12.5 mg",
      "lisinopril hydrochlorothiazide oral tablet 20 12.5 mg", 1, ql(60, 30)],
    ["hydrocortisone oral tablet 10 mg, 20 mg", "hydrocortisone oral tablet 10 mg", 2],
    // Only the non-ER lamotrigine is on True Blue → Felix's 250 mg ER matches fuzzily.
    ["lamotrigine oral tablet 25 mg, 100 mg, 150 mg, 200 mg",
      "lamotrigine oral tablet 25 mg 100 mg 150 mg 200 mg", 2],
    ["levothyroxine sodium oral tablet", "levothyroxine sodium oral tablet 75 mcg", 1],
    ["rosuvastatin calcium oral tablet 5 mg, 10 mg, 20 mg, 40 mg",
      "rosuvastatin calcium oral tablet 5 mg", 2, ql(30, 30)],
    ["tamsulosin hcl oral capsule 0.4 mg", "tamsulosin hcl oral capsule 0.4 mg", 2],
    ["fluoxetine hcl oral capsule 10 mg, 20 mg, 40 mg",
      "fluoxetine hcl oral capsule 10 mg", 1],
  ]),
  // ── Humana Value formulary ────────────────────────────────────────────────
  ...mkEntries(fHumanaValue!.id, [
    ["atorvastatin 10 mg, 20 mg, 40 mg, 80 mg tablet",
      "atorvastatin calcium oral tablet 20 mg", 1],
    ["diltiazem hcl 120 mg, 180 mg, 240 mg, 300 mg capsule er 24 hr",
      "diltiazem hcl er oral capsule extended release 24 hour 240 mg", 2],
    ["ELIQUIS 2.5 mg, 5 mg tablet", "eliquis 2.5 mg, 5 mg tablet", 3, { isBrand: true, ...ql(60, 30) }],
    ["losartan potassium 25 mg, 50 mg, 100 mg tablet",
      "losartan potassium oral tablet 25 mg 50 mg 100 mg", 1],
    ["metoprolol succinate 25 mg, 50 mg, 100 mg tablet er 24 hr",
      "metoprolol succinate er oral tablet extended release 24 hour 50 mg", 1],
    ["sertraline 100 mg tablet", "sertraline hcl oral tablet 100 mg", 1, ql(60, 30)],
    ["amiodarone 200 mg tablet", "amiodarone hcl oral tablet 200 mg", 2],
    ["carvedilol 3.125 mg, 6.25 mg, 12.5 mg, 25 mg tablet",
      "carvedilol oral tablet 3.125 mg", 1],
    ["lisinopril-hydrochlorothiazide 20-12.5 mg tablet",
      "lisinopril hydrochlorothiazide oral tablet 20 12.5 mg", 1],
    // Hydrocortisone tablet (Cortef) deliberately absent → not_on_formulary on Humana.
    ["lamotrigine 25 mg, 50 mg, 100 mg, 200 mg, 250 mg, 300 mg tablet er 24 hr",
      "lamotrigine oral tablet er extended release 24 hour 250 mg", 4],
    ["levothyroxine 25 mcg, 50 mcg, 75 mcg, 100 mcg, 125 mcg, 150 mcg tablet",
      "levothyroxine sodium oral tablet 75 mcg", 1],
    ["rosuvastatin 5 mg, 10 mg, 20 mg, 40 mg tablet",
      "rosuvastatin calcium oral tablet 5 mg", 1],
    ["tamsulosin 0.4 mg capsule", "tamsulosin hcl oral capsule 0.4 mg", 1],
    ["fluoxetine 10 mg, 20 mg capsule", "fluoxetine hcl oral capsule 10 mg", 2, ql(60, 30)],
  ]),
]);

// ── plans ────────────────────────────────────────────────────────────────────
const [trueBlue33, humanaValue] = await db
  .insert(s.plans)
  .values([
    {
      carrierId: bci!.id,
      formularyId: fTrueBlue!.id,
      planYear: YEAR,
      name: "True Blue Rx 33 (HMO)",
      contractPlanId: "H1350-033",
      premiumCents: 5900,
      rxDeductibleCents: 17500, // Tiers 3-5, per SoB
      deductibleTiers: [3, 4, 5],
    },
    {
      carrierId: humana!.id,
      formularyId: fHumanaValue!.id,
      planYear: YEAR,
      name: "Humana Value Rx Plan (PDP)",
      contractPlanId: "S5884-210",
      premiumCents: 1940,
      rxDeductibleCents: 61500, // $615, Tiers 3-5 (SoB p.4)
      deductibleTiers: [3, 4, 5],
    },
  ])
  .returning();

await db.insert(s.planServiceAreas).values(
  [trueBlue33, humanaValue].flatMap((p) => [{ planId: p!.id, state: "ID", county: "Blaine" }]),
);

// ── plan tier costs (real, from each 2026 Summary of Benefits) ──────────────
type TierCostInsert = typeof s.planTierCosts.$inferInsert;
type TierRow = [TierCostInsert["tier"], number | null, string | null];
const tierRows = (
  planId: string,
  channel: TierCostInsert["channel"],
  daysSupply: number,
  rows: TierRow[],
) =>
  rows.map(([tier, copayCents, coinsurancePct]) => ({
    planId,
    channel,
    tier,
    daysSupply,
    copayCents,
    coinsurancePct,
  }));

await db.insert(s.planTierCosts).values([
  // True Blue Rx 33 — preferred/standard retail + standard mail (SoB p.6).
  // Mail column prints a single value alongside retail, so it is priced as a
  // 30-day-equivalent (daysSupply 30) rather than divided as a 90-day fill.
  ...tierRows(trueBlue33!.id, "preferred_retail", 30, [
    ["t1", 0, null], ["t2", 600, null], ["t3", 4000, null],
    ["t4", null, "25.00"], ["t5", null, "28.00"], ["insulin", 3500, null],
  ]),
  ...tierRows(trueBlue33!.id, "standard_retail", 30, [
    ["t1", 0, null], ["t2", 1500, null], ["t3", 4700, null],
    ["t4", null, "25.00"], ["t5", null, "28.00"], ["insulin", 3500, null],
  ]),
  ...tierRows(trueBlue33!.id, "standard_mail", 30, [
    ["t1", 0, null], ["t2", 600, null], ["t3", 4000, null],
    ["t4", null, "25.00"], ["t5", null, "28.00"], ["insulin", 3500, null],
  ]),

  // Humana Value — std/pref retail (30-day) + std/pref mail (90-day) (SoB p.4-5).
  ...tierRows(humanaValue!.id, "standard_retail", 30, [
    ["t1", 100, null], ["t2", 400, null], ["t3", null, "20.00"],
    ["t4", null, "32.00"], ["t5", null, "26.00"], ["insulin", 3500, null],
  ]),
  ...tierRows(humanaValue!.id, "preferred_retail", 30, [
    ["t1", 0, null], ["t2", 0, null], ["t3", null, "20.00"],
    ["t4", null, "32.00"], ["t5", null, "26.00"], ["insulin", 3500, null],
  ]),
  ...tierRows(humanaValue!.id, "standard_mail", 90, [
    ["t1", 300, null], ["t2", 1200, null], ["t3", null, "20.00"],
    ["t4", null, "32.00"], ["t5", null, "26.00"], ["insulin", 10500, null],
  ]),
  ...tierRows(humanaValue!.id, "preferred_mail", 90, [
    ["t1", 0, null], ["t2", 0, null], ["t3", null, "15.00"],
    ["t4", null, "32.00"], ["t5", null, "26.00"], ["insulin", 10500, null],
  ]),
]);

// ── pharmacies (Blaine County; NPIs are synthetic test values) ──────────────
const [drugStore, atkinsons, albertsons] = await db
  .insert(s.pharmacies)
  .values([
    {
      name: "The Drug Store",
      npi: "1000000001",
      altNames: ["Hailey Drug"],
      address1: "91 E Croy St",
      city: "Hailey",
      state: "ID",
      zip: "83333",
      county: "Blaine",
      phone: "208-788-2222",
      source: "manual",
    },
    {
      name: "Atkinsons' Pharmacy",
      npi: "1000000002",
      address1: "451 4th St E",
      city: "Ketchum",
      state: "ID",
      zip: "83340",
      county: "Blaine",
      phone: "208-726-5668",
      source: "manual",
    },
    {
      name: "Albertsons Pharmacy",
      npi: "1000000003",
      address1: "111 N Main St",
      city: "Hailey",
      state: "ID",
      zip: "83333",
      county: "Blaine",
      phone: "208-788-3333",
      source: "manual",
    },
  ])
  .returning();

// Per-plan network status — the cost-matrix driver. Varied on purpose; note
// Albertsons has NO True Blue row → the app assumes standard (amber).
await db.insert(s.planPharmacyNetworks).values([
  { planId: trueBlue33!.id, pharmacyId: drugStore!.id, status: "preferred", source: "agent" },
  { planId: humanaValue!.id, pharmacyId: drugStore!.id, status: "standard", source: "agent" },
  { planId: trueBlue33!.id, pharmacyId: atkinsons!.id, status: "standard", source: "agent" },
  { planId: humanaValue!.id, pharmacyId: atkinsons!.id, status: "preferred", source: "agent" },
  // Albertsons: True Blue row intentionally omitted (assumed path);
  { planId: humanaValue!.id, pharmacyId: albertsons!.id, status: "out_of_network", source: "agent" },
]);

// ── clients (the three real RxC exports) ────────────────────────────────────
type MedRow = [
  name: string,
  strength: string | null,
  form: string | null,
  dosageText: string,
  quantity: number | null,
  daysSupply: number | null,
  source?: typeof s.clientMedications.$inferInsert.source,
];
const mkMeds = (clientId: string, rows: MedRow[]) =>
  rows.map(([name, strength, form, dosageText, quantity, daysSupply, source], position) => ({
    clientId,
    rawText: dosageText,
    name,
    strength,
    form,
    dosageText,
    quantity,
    daysSupply,
    genericOk: true,
    source: source ?? ("structured" as const),
    confirmed: true,
    position,
  }));

// ── Marilyn Healy — Hailey, The Drug Store, current Humana PDP ───────────────
const [marilyn] = await db
  .insert(s.clients)
  .values({
    fullName: "Marilyn Healy",
    zip: "83333",
    state: "ID",
    county: "Blaine",
    takesPrescriptions: true,
    deliveryPreferred: false,
    mailOrderInterest: "no",
  })
  .returning();

await db.insert(s.clientPharmacies).values({
  clientId: marilyn!.id,
  rank: 1,
  rawText: "The Drug Store - 91 E Croy Hailey ID 83333",
  pharmacyId: drugStore!.id,
  matchConfidence: "0.980",
  confirmed: true,
});

await db.insert(s.clientMedications).values(
  mkMeds(marilyn!.id, [
    ["atorvastatin calcium", "20 mg", "tablet", "atorvastatin calcium TAB 20MG", 60, 60],
    ["diltiazem hcl er", "240 mg", "capsule", "diltiazem hydrochloride er (extended release beads) CAP 240MG/24", 90, 90],
    ["Eliquis", "2.5 mg", "tablet", "Eliquis TAB 2.5MG", 60, 30],
    ["losartan potassium", "50 mg", "tablet", "losartan potassium TAB 50MG", 60, 60],
    ["metoprolol succinate er", "50 mg", "tablet er", "metoprolol succinate er TAB 50MG ER", 90, 60],
    ["sertraline hcl", "100 mg", "tablet", "sertraline hcl TAB 100MG", 60, 60],
  ]),
);

await db.insert(s.inForcePolicies).values([
  {
    clientId: marilyn!.id,
    rawText: "Humana - H94324997 - PDP",
    carrierName: "Humana",
    policyNumber: "H94324997",
    policyType: "pdp",
    isCurrentDrugPlan: true,
    matchedPlanId: humanaValue!.id, // her current drug plan is one we seeded
  },
  {
    clientId: marilyn!.id,
    rawText: "MODA - T02330968 - Med Supp",
    carrierName: "MODA",
    policyNumber: "T02330968",
    policyType: "med_supp",
  },
]);

// ── Gregory Smith — Ketchum, NO preferred pharmacy, current WellCare (unseeded) ─
const [gregory] = await db
  .insert(s.clients)
  .values({
    fullName: "Gregory Smith",
    zip: "83340",
    state: "ID",
    county: "Blaine",
    takesPrescriptions: true,
    deliveryPreferred: false,
    mailOrderInterest: "ask_client",
  })
  .returning();

await db.insert(s.clientMedications).values(
  mkMeds(gregory!.id, [
    ["amiodarone hcl", "200 mg", "tablet", "amiodarone hydrochloride TAB 200MG", 30, 30],
    ["carvedilol", "3.125 mg", "tablet", "carvedilol TAB 3.125MG", 60, 30],
    ["Eliquis", "5 mg", "tablet", "Eliquis TAB 5MG", 90, 90],
    ["lisinopril hydrochlorothiazide", "20-12.5", "tablet", "lisinopril/hctz TAB 20-12.5", 30, 30],
  ]),
);

await db.insert(s.inForcePolicies).values([
  {
    clientId: gregory!.id,
    rawText: "Delta Dental - 995292099 - Dental",
    carrierName: "Delta Dental",
    policyNumber: "995292099",
    policyType: "other",
  },
  {
    clientId: gregory!.id,
    rawText: "WellCare - 46334678 - PDP",
    carrierName: "WellCare",
    policyNumber: "46334678",
    policyType: "pdp",
    isCurrentDrugPlan: true,
    matchedPlanId: null, // WellCare is not among our seeded plans → handled as unmatched
  },
  {
    clientId: gregory!.id,
    rawText: "Blue Cross of Idaho - 101415388 - Med Supp",
    carrierName: "Blue Cross of Idaho",
    policyNumber: "101415388",
    policyType: "med_supp",
  },
]);

// ── Felix Gonzalez — Ketchum, NO pharmacy, no in-force policies, freetext extras ─
const [felix] = await db
  .insert(s.clients)
  .values({
    fullName: "Felix Gonzalez",
    zip: "83340",
    state: "ID",
    county: "Blaine",
    takesPrescriptions: true,
    deliveryPreferred: false,
    mailOrderInterest: "ask_client",
  })
  .returning();

await db.insert(s.clientMedications).values(
  mkMeds(felix!.id, [
    ["hydrocortisone", "10 mg", "tablet", "Cortef hydrocortisone (Tablets) TAB 10MG", 60, 30],
    ["lamotrigine", "250 mg", "tablet er", "lamotrigine TAB 250MG ER", 90, 90],
    ["levothyroxine sodium", "75 mcg", "tablet", "levothyroxine sodium (tablets) TAB 75MCG", 90, 90],
    ["rosuvastatin calcium", "5 mg", "tablet", "rosuvastatin calcium TAB 5MG", 90, 90],
    ["tamsulosin hcl", "0.4 mg", "capsule", "tamsulosin hcl CAP 0.4MG", 180, 90],
    // Free-text "Additional Information" box (fluoxetine is the parseable one):
    ["fluoxetine", "10 mg", "capsule", "fluoxetine 10 mg, 180 tab", 180, 90, "freetext"],
  ]),
);

// ── Marilyn's analysis, pre-wired (compare True Blue vs her current Humana) ──
const [analysis] = await db
  .insert(s.analyses)
  .values({
    clientId: marilyn!.id,
    planYear: YEAR,
    status: "new",
    includeMailOrder: false,
  })
  .returning();

await db.insert(s.analysisPlans).values([
  { analysisId: analysis!.id, planId: trueBlue33!.id, position: 0, isCurrent: false },
  { analysisId: analysis!.id, planId: humanaValue!.id, position: 1, isCurrent: true },
]);

// Compare all three Blaine-County pharmacies so the cost matrix is multi-row
// out of the box (Albertsons has no True Blue network row → assumed/amber).
await db.insert(s.analysisPharmacies).values([
  { analysisId: analysis!.id, pharmacyId: drugStore!.id, position: 0 },
  { analysisId: analysis!.id, pharmacyId: atkinsons!.id, position: 1 },
  { analysisId: analysis!.id, pharmacyId: albertsons!.id, position: 2 },
]);

console.log("Seeded 2 plans, 3 pharmacies, 3 clients (Healy/Smith/Gonzalez), 1 analysis.");
process.exit(0);
