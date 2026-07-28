/**
 * Development seed — synthetic data mirroring the shapes of the real sample
 * set (Bentley/Brown reports, screen walkthrough, 2026 formularies).
 * Idempotent: wipes and re-inserts reference + demo data.
 * Never run against a production database.
 */
import "./load-env";
import { createDb } from "./client";
import * as s from "./schema";

const db = createDb();

// ── wipe (children first) ────────────────────────────────────────────────────
await db.delete(s.reportOverrides);
await db.delete(s.analysisResults);
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
const [uhc, bci, pacs, humana, molina] = await db
  .insert(s.carriers)
  .values([
    { name: "UnitedHealthcare", slug: "uhc" },
    { name: "Blue Cross of Idaho", slug: "bci" },
    { name: "Pacific Source", slug: "pacific-source" },
    { name: "Humana", slug: "humana" },
    { name: "Molina", slug: "molina" },
  ])
  .returning();

// ── ZIP → county (Blaine County test ZIPs from the sample RxC exports) ──────
await db.insert(s.zipCounties).values([
  { zip: "83333", state: "ID", county: "Blaine" }, // Hailey
  { zip: "83340", state: "ID", county: "Blaine" }, // Ketchum
  { zip: "83313", state: "ID", county: "Blaine" }, // Bellevue
  { zip: "83353", state: "ID", county: "Blaine" }, // Sun Valley
]);

// ── formularies (metadata only; entries come from the ingestion pipeline) ───
const year = 2026;
const [fTrueBlue, fUhc, fPacs] = await db
  .insert(s.formularies)
  .values([
    {
      carrierId: bci!.id,
      planYear: year,
      label: "2026 True Blue Rx (all True Blue plans)",
      formularyCode: "00026046 V08",
      versionDate: "01/01/2026",
      status: "active" as const,
    },
    {
      carrierId: uhc!.id,
      planYear: year,
      label: "2026 UHC Rx formulary",
      status: "active" as const,
    },
    {
      carrierId: pacs!.id,
      planYear: year,
      label: "2026 Pacific Source formulary",
      status: "active" as const,
    },
  ])
  .returning();

// A handful of formulary entries so the analysis engine has real rows to join
// against in dev (mirrors Bentley/Healy meds; tiers taken from sample reports).
const mkEntries = (
  formularyId: string,
  rows: Array<
    [name: string, tier: number, opts?: Partial<typeof s.formularyEntries.$inferInsert>]
  >,
) =>
  rows.map(([rawDrugName, tier, opts], i) => ({
    formularyId,
    rawDrugName,
    normalizedName: rawDrugName.toLowerCase().replace(/\s+/g, " "),
    tier,
    sourcePage: 10 + i,
    ...opts,
  }));

await db.insert(s.formularyEntries).values([
  ...mkEntries(fUhc!.id, [
    ["allopurinol oral tablet 100 mg", 1],
    ["losartan potassium oral tablet 50 mg", 1],
    ["lorazepam oral tablet 0.5 mg", 2],
    ["minoxidil oral tablet 2.5 mg", 2, { qlQuantity: 90, qlDays: 30 }],
    ["estradiol vaginal cream", 3],
    ["atorvastatin calcium oral tablet 20 mg", 1],
    ["ELIQUIS", 3, { isBrand: true }],
    ["sertraline hcl oral tablet 100 mg", 1],
  ]),
  ...mkEntries(fTrueBlue!.id, [
    ["allopurinol oral tablet 100 mg", 1],
    ["losartan potassium oral tablet 50 mg", 6],
    ["lorazepam oral tablet 0.5 mg", 1],
    ["minoxidil oral tablet 2.5 mg", 2],
    ["estradiol vaginal cream", 2],
    ["atorvastatin calcium oral tablet 20 mg", 1],
    ["ELIQUIS", 3, { isBrand: true, pa: true }],
    ["sertraline hcl oral tablet 100 mg", 1],
  ]),
  ...mkEntries(fPacs!.id, [
    ["allopurinol oral tablet 100 mg", 1],
    ["losartan potassium oral tablet 50 mg", 1],
    ["lorazepam oral tablet 0.5 mg", 2],
    ["minoxidil oral tablet 2.5 mg", 2],
    ["atorvastatin calcium oral tablet 20 mg", 1],
    ["sertraline hcl oral tablet 100 mg", 2],
    // estradiol cream deliberately absent → "Not on Formulary" path
  ]),
]);

// ── plans ────────────────────────────────────────────────────────────────────
const [uhc0009, trueBlue33, myCare24, humanaBasic] = await db
  .insert(s.plans)
  .values([
    {
      carrierId: uhc!.id,
      formularyId: fUhc!.id,
      planYear: year,
      name: "UHC Plan 0009",
      premiumCents: 0,
      rxDeductibleCents: 34000,
      deductibleTiers: [3, 4, 5],
    },
    {
      carrierId: bci!.id,
      formularyId: fTrueBlue!.id,
      planYear: year,
      name: "True Blue Rx 33 (HMO)",
      premiumCents: 0,
      rxDeductibleCents: 27500,
      deductibleTiers: [3, 4, 5],
    },
    {
      carrierId: pacs!.id,
      formularyId: fPacs!.id,
      planYear: year,
      name: "MyCare 24",
      premiumCents: 3900,
      rxDeductibleCents: 19900,
      deductibleTiers: [3, 4, 5],
    },
    {
      carrierId: humana!.id,
      formularyId: null,
      planYear: year,
      name: "Humana Basic Rx",
      premiumCents: 2250,
      rxDeductibleCents: 31000,
      deductibleTiers: [3, 4, 5],
      curated: false,
    },
  ])
  .returning();

await db.insert(s.planServiceAreas).values(
  [uhc0009, trueBlue33, myCare24, humanaBasic].flatMap((p) => [
    { planId: p!.id, state: "ID", county: "Blaine" },
    { planId: p!.id, state: "ID", county: "Ada" },
  ]),
);

// ── plan tier costs (from the Bentley report's per-plan benefit tables) ─────
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
  // UHC 0009 — single in-network retail table (modeled as standard_retail)
  ...tierRows(uhc0009!.id, "standard_retail", 30, [
    ["t1", 0, null],
    ["t2", 800, null],
    ["t3", 4700, null],
    ["t4", null, "100.00"],
    ["t5", null, "29.00"],
    ["insulin", 3500, null],
  ]),
  // True Blue 33 — preferred + standard + mail order (screen 7 values)
  ...tierRows(trueBlue33!.id, "preferred_retail", 30, [
    ["t1", 1000, null],
    ["t2", 1500, null],
    ["t3", 4700, null],
    ["t4", null, "50.00"],
    ["t5", null, "29.00"],
    ["t6", 0, null],
    ["insulin", 3500, null],
  ]),
  ...tierRows(trueBlue33!.id, "standard_retail", 30, [
    ["t1", 1500, null],
    ["t2", 2000, null],
    ["t3", 4700, null],
    ["t4", null, "50.00"],
    ["t5", null, "29.00"],
    ["t6", 0, null],
    ["insulin", 3500, null],
  ]),
  ...tierRows(trueBlue33!.id, "standard_mail", 90, [
    ["t1", 0, null],
    ["t2", 3000, null],
    ["t3", 13100, null],
    ["t4", null, "50.00"],
    ["t5", null, "29.00"],
    ["t6", 0, null],
    ["insulin", 9500, null],
  ]),
  // MyCare 24 — standard + preferred retail, plus a preferred mail table
  // (CenterWell-style) so the demo exercises all four channels.
  ...tierRows(myCare24!.id, "standard_retail", 30, [
    ["t1", 0, null],
    ["t2", 1200, null],
    ["t3", 4700, null],
    ["t4", null, "30.00"],
    ["t5", null, "30.00"],
    ["insulin", 3500, null],
  ]),
  ...tierRows(myCare24!.id, "preferred_retail", 30, [
    ["t1", 800, null],
    ["t2", 1700, null],
    ["t3", 4700, null],
    ["t4", null, "31.00"],
    ["t5", null, "30.00"],
    ["insulin", 3500, null],
  ]),
  ...tierRows(myCare24!.id, "preferred_mail", 90, [
    ["t1", 0, null],
    ["t2", 0, null],
    ["t3", 12000, null],
    ["t4", null, "31.00"],
    ["t5", null, "30.00"],
    ["insulin", 9500, null],
  ]),
  ...tierRows(myCare24!.id, "standard_mail", 90, [
    ["t1", 300, null],
    ["t2", 3600, null],
    ["t3", 14100, null],
    ["t4", null, "32.00"],
    ["t5", null, "30.00"],
    ["insulin", 10500, null],
  ]),
]);

// ── pharmacies + per-plan network status ────────────────────────────────────
const [valley, drugStore] = await db
  .insert(s.pharmacies)
  .values([
    {
      name: "Valley Apothecary",
      address1: "511 N Main St",
      city: "Hailey",
      state: "ID",
      zip: "83333",
      county: "Blaine",
      source: "manual",
    },
    {
      name: "The Drug Store",
      address1: "91 E Croy St",
      city: "Hailey",
      state: "ID",
      zip: "83333",
      county: "Blaine",
      source: "manual",
    },
  ])
  .returning();

await db.insert(s.planPharmacyNetworks).values([
  { planId: uhc0009!.id, pharmacyId: valley!.id, status: "preferred", source: "agent" },
  { planId: trueBlue33!.id, pharmacyId: valley!.id, status: "preferred", source: "agent" },
  { planId: myCare24!.id, pharmacyId: valley!.id, status: "standard", source: "agent" },
  { planId: uhc0009!.id, pharmacyId: drugStore!.id, status: "preferred", source: "agent" },
  { planId: trueBlue33!.id, pharmacyId: drugStore!.id, status: "standard", source: "agent" },
  { planId: myCare24!.id, pharmacyId: drugStore!.id, status: "standard", source: "agent" },
]);

// ── demo client (synthetic, Healy-shaped) ───────────────────────────────────
const [demo] = await db
  .insert(s.clients)
  .values({
    fullName: "Demo Client",
    zip: "83333",
    state: "ID",
    county: "Blaine",
    takesPrescriptions: true,
    deliveryPreferred: false,
    mailOrderInterest: "ask_client",
  })
  .returning();

await db.insert(s.clientPharmacies).values([
  {
    clientId: demo!.id,
    rank: 1,
    rawText: "The Drug Store - 91 E Croy Hailey ID 83333",
    pharmacyId: drugStore!.id,
    matchConfidence: "0.980",
    confirmed: true,
  },
  {
    clientId: demo!.id,
    rank: 2,
    rawText: "Valley Apothecary - 16 W Bullion Hailey ID 83333",
    pharmacyId: valley!.id,
    matchConfidence: "0.960",
    confirmed: true,
  },
]);

await db.insert(s.clientMedications).values(
  (
    [
      ["atorvastatin calcium", "atorvastatin calcium TAB 20MG", 60, 60],
      ["losartan potassium", "losartan potassium TAB 50MG", 60, 60],
      ["Eliquis", "Eliquis TAB 2.5MG", 60, 30],
      ["sertraline hcl", "sertraline hcl TAB 100MG", 60, 60],
    ] as const
  ).map(([name, dosageText, quantity, daysSupply], position) => ({
    clientId: demo!.id,
    rawText: `${name} ${dosageText}`,
    name,
    dosageText,
    quantity,
    daysSupply,
    genericOk: true,
    source: "structured" as const,
    confirmed: true,
    position,
  })),
);

await db.insert(s.inForcePolicies).values([
  {
    clientId: demo!.id,
    rawText: "Humana - H94324997 - PDP",
    carrierName: "Humana",
    policyNumber: "H94324997",
    policyType: "pdp",
    isCurrentDrugPlan: true,
  },
  {
    clientId: demo!.id,
    rawText: "MODA - T02330968 - Med Supp",
    carrierName: "MODA",
    policyNumber: "T02330968",
    policyType: "med_supp",
  },
]);

console.log("seed complete");
process.exit(0);
