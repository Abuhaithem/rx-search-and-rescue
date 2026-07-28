/**
 * Golden fixture: the Bentley, Barb — Medicare Analysis comparison
 * (Discovery Findings §4). Three plans — UHC 0009, Blue Cross Essentials,
 * Pacific Source MyCare 24 — against Bentley's nine medications.
 *
 * Ground truth taken from the real reports:
 *  - Drug × plan tier grid (Bentley report, tier-only cells).
 *  - UHC benefit table: T1 $0, T2 $8, T3 $47, T4 100%, T5 29%, Insulin $35.
 *  - Cross-checked against Brown's $cost-Tier cells on the same three plans:
 *    Celecoxib $8-T2 (UHC) / $10-T1 (BC) / $12-T2 (PacSource);
 *    Pravastatin $0-T1 / $0-T6 / $0-T1; Budesonide 50% (BC) / 30% (PacSource).
 *  - Deductibles $340 / $275 / $199; premiums $0.00 / $0.00 / $39.00.
 *  - Client pharmacy Valley Apothecary: preferred on UHC + Blue Cross,
 *    standard on Pacific Source ("you will receive Standard Pricing on the
 *    Pacific Source plan").
 *
 * BC T2 copay ($15) is not visible in either report; it is a fixed synthetic
 * value chosen for determinism. Everything else is report-derived.
 */
import type {
  EngineFormularyEntry,
  EngineMedication,
  EnginePlan,
} from "../../src/analysis/engine";

export const UHC_ID = "uhc-0009";
export const BC_ID = "bc-essentials";
export const PS_ID = "ps-mycare-24";

export const PLAN_IDS = [UHC_ID, BC_ID, PS_ID] as const;

// ── Medications ──────────────────────────────────────────────────────────────

interface MedSpec {
  id: string;
  name: string;
  normalizedName: string;
  rxcui: string;
  prn: boolean;
  /** [UHC, Blue Cross, Pacific Source] formulary tiers from the report grid. */
  tiers: [number, number, number];
}

export const BENTLEY_MED_SPECS: MedSpec[] = [
  {
    id: "med-allopurinol",
    name: "Allopurinol",
    normalizedName: "allopurinol 300 mg oral tablet",
    rxcui: "519",
    prn: false,
    tiers: [1, 1, 1],
  },
  {
    id: "med-estradiol-cream",
    name: "Estradiol Cream",
    normalizedName: "estradiol 0.01% vaginal cream",
    rxcui: "4100",
    prn: false,
    tiers: [3, 2, 2],
  },
  {
    id: "med-fluticasone",
    name: "Fluticasone",
    normalizedName: "fluticasone propionate 50 mcg nasal spray",
    rxcui: "41126",
    prn: false,
    tiers: [1, 1, 2],
  },
  {
    id: "med-hydrocodone-acet",
    name: "Hydrocodone/Acet",
    normalizedName: "hydrocodone acetaminophen 5 mg/325 mg oral tablet",
    rxcui: "857005",
    prn: true,
    tiers: [3, 3, 4],
  },
  {
    id: "med-indomethacin",
    name: "Indomethacin",
    normalizedName: "indomethacin 25 mg oral capsule",
    rxcui: "5781",
    prn: true,
    tiers: [2, 2, 2],
  },
  {
    id: "med-lorazepam",
    name: "Lorazepam",
    normalizedName: "lorazepam 0.5 mg oral tablet",
    rxcui: "6470",
    prn: false,
    tiers: [2, 1, 2],
  },
  {
    id: "med-losartan",
    name: "Losartan",
    normalizedName: "losartan potassium 50 mg oral tablet",
    rxcui: "52175",
    prn: false,
    tiers: [1, 6, 1],
  },
  {
    id: "med-minoxidil",
    name: "Minoxidil",
    normalizedName: "minoxidil 2.5 mg oral tablet",
    rxcui: "6984",
    prn: false,
    tiers: [2, 2, 2],
  },
  {
    id: "med-tizanidine",
    name: "Tizanidine",
    normalizedName: "tizanidine 4 mg oral tablet",
    rxcui: "37418",
    prn: true,
    tiers: [2, 1, 2],
  },
];

export const bentleyMedications: EngineMedication[] = BENTLEY_MED_SPECS.map((m) => ({
  id: m.id,
  name: m.name,
  normalizedName: m.normalizedName,
  rxcuis: [m.rxcui],
  relatedRxcuis: [],
  genericOk: true,
  prn: m.prn,
  quantity: 30,
  daysSupply: 30,
}));

/** medicationId → [UHC, BC, PacSource] expected tier, straight from the report grid. */
export const BENTLEY_EXPECTED_TIERS: Record<string, [number, number, number]> =
  Object.fromEntries(BENTLEY_MED_SPECS.map((m) => [m.id, m.tiers]));

// ── Formulary entries (one per med per plan, exact-RXCUI matchable) ─────────

const entriesForPlan = (planKey: "uhc" | "bc" | "ps", tierIndex: 0 | 1 | 2): EngineFormularyEntry[] =>
  BENTLEY_MED_SPECS.map((m) => ({
    id: `${planKey}-${m.id}`,
    rawDrugName: m.normalizedName,
    normalizedName: m.normalizedName,
    rxcuis: [m.rxcui],
    isBrand: false,
    tier: m.tiers[tierIndex],
    pa: false,
    st: false,
    qlQuantity: null,
    qlDays: null,
    extraFlags: [],
  }));

const withRestrictions = (
  entries: EngineFormularyEntry[],
  entryId: string,
  patch: Partial<EngineFormularyEntry>,
): EngineFormularyEntry[] =>
  entries.map((e) => (e.id === entryId ? { ...e, ...patch } : e));

// Restriction realism: UHC restricts the opioid ("PA; QL (60 per 30 days); NEDS"
// grammar family), Pacific Source step-therapies tizanidine.
const uhcEntries = withRestrictions(entriesForPlan("uhc", 0), "uhc-med-hydrocodone-acet", {
  pa: true,
  qlQuantity: 60,
  qlDays: 30,
  extraFlags: ["NEDS"],
});
const bcEntries = entriesForPlan("bc", 1);
const psEntries = withRestrictions(entriesForPlan("ps", 2), "ps-med-tizanidine", {
  st: true,
});

// ── Plans ────────────────────────────────────────────────────────────────────

export const bentleyPlans: EnginePlan[] = [
  {
    id: UHC_ID,
    name: "UHC 0009",
    premiumCents: 0,
    rxDeductibleCents: 34000,
    deductibleTiers: [3, 4, 5],
    entries: uhcEntries,
    // UHC publishes a single in-network table (standard_retail): T1 $0, T2 $8,
    // T3 $47, T4 100%, T5 29%, Covered Insulin $35.
    tierCosts: [
      { channel: "standard_retail", tier: "t1", daysSupply: 30, copayCents: 0, coinsurancePct: null },
      { channel: "standard_retail", tier: "t2", daysSupply: 30, copayCents: 800, coinsurancePct: null },
      { channel: "standard_retail", tier: "t3", daysSupply: 30, copayCents: 4700, coinsurancePct: null },
      { channel: "standard_retail", tier: "t4", daysSupply: 30, copayCents: null, coinsurancePct: 100 },
      { channel: "standard_retail", tier: "t5", daysSupply: 30, copayCents: null, coinsurancePct: 29 },
      { channel: "standard_retail", tier: "insulin", daysSupply: 30, copayCents: 3500, coinsurancePct: null },
    ],
    clientPharmacyStatus: "preferred",
  },
  {
    id: BC_ID,
    name: "Blue Cross Essentials",
    premiumCents: 0,
    rxDeductibleCents: 27500,
    deductibleTiers: [3, 4, 5],
    entries: bcEntries,
    // Blue Cross preferred table: T1 $10 (Celecoxib $10-T1), T3 50% coinsurance
    // (Budesonide "50% Cost of Medication"), T6 $0 (Pravastatin $0-T6).
    // T2 $15 is synthetic (not visible in the sample reports).
    tierCosts: [
      { channel: "preferred_retail", tier: "t1", daysSupply: 30, copayCents: 1000, coinsurancePct: null },
      { channel: "preferred_retail", tier: "t2", daysSupply: 30, copayCents: 1500, coinsurancePct: null },
      { channel: "preferred_retail", tier: "t3", daysSupply: 30, copayCents: null, coinsurancePct: 50 },
      { channel: "preferred_retail", tier: "t6", daysSupply: 30, copayCents: 0, coinsurancePct: null },
    ],
    clientPharmacyStatus: "preferred",
  },
  {
    id: PS_ID,
    name: "Pacific Source MyCare 24",
    premiumCents: 3900,
    rxDeductibleCents: 19900,
    deductibleTiers: [3, 4, 5],
    entries: psEntries,
    // Pacific Source publishes Standard AND Preferred columns. Valley
    // Apothecary is STANDARD here, so the engine must price from the standard
    // table: T2 $12 (Celecoxib $12-T2), T3 30% (Budesonide "30% Cost of
    // Medication"), T1 $0 (Pravastatin $0-T1). Preferred values are strictly
    // lower so a wrong channel pick is detectable. Mail-order rows are 90-day.
    tierCosts: [
      { channel: "standard_retail", tier: "t1", daysSupply: 30, copayCents: 0, coinsurancePct: null },
      { channel: "standard_retail", tier: "t2", daysSupply: 30, copayCents: 1200, coinsurancePct: null },
      { channel: "standard_retail", tier: "t3", daysSupply: 30, copayCents: null, coinsurancePct: 30 },
      { channel: "standard_retail", tier: "t4", daysSupply: 30, copayCents: null, coinsurancePct: 50 },
      { channel: "preferred_retail", tier: "t1", daysSupply: 30, copayCents: 0, coinsurancePct: null },
      { channel: "preferred_retail", tier: "t2", daysSupply: 30, copayCents: 1000, coinsurancePct: null },
      { channel: "preferred_retail", tier: "t3", daysSupply: 30, copayCents: null, coinsurancePct: 25 },
      { channel: "preferred_retail", tier: "t4", daysSupply: 30, copayCents: null, coinsurancePct: 45 },
      { channel: "standard_mail", tier: "t1", daysSupply: 90, copayCents: 0, coinsurancePct: null },
      { channel: "standard_mail", tier: "t2", daysSupply: 90, copayCents: 2400, coinsurancePct: null },
      { channel: "standard_mail", tier: "t4", daysSupply: 90, copayCents: null, coinsurancePct: 50 },
    ],
    clientPharmacyStatus: "standard",
  },
];

// ── Expected plan-level figures (hand-computed from the tables above) ───────
// Non-PRN meds only: Allopurinol, Estradiol Cream, Fluticasone, Lorazepam,
// Losartan, Minoxidil.
//   UHC (falls back to its standard table):  $0 + $47 + $0 + $8 + $0 + $8 = $63
//   BC  (preferred):                        $10 + $15 + $10 + $10 + $0 + $15 = $60
//   PS  (standard, NOT preferred):           $0 + $12 + $12 + $12 + $0 + $12 = $48
export const BENTLEY_EXPECTED_EST_MONTHLY_CENTS: Record<string, number> = {
  [UHC_ID]: 6300,
  [BC_ID]: 6000,
  [PS_ID]: 4800,
};

/** PS priced via standard_mail override: 90-day copays ÷ 3 → 4 × $8 = $32. */
export const PS_MAIL_ORDER_EST_MONTHLY_CENTS = 3200;
