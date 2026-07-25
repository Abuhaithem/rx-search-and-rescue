/**
 * Engine tests anchored on the Bentley golden fixture — the product's ground
 * truth (CLAUDE.md Testing). Every grid assertion below traces to a cell of
 * the real "Bentley, Barb — Medicare Analysis" report.
 */
import { describe, expect, it } from "vitest";
import {
  findTierCost,
  matchMedication,
  resolveChannel,
  runAnalysis,
  type CellResult,
  type EngineFormularyEntry,
  type EngineMedication,
  type EnginePlan,
} from "./engine";
import { tierFromNumber } from "../types";
import {
  BC_ID,
  BENTLEY_EXPECTED_EST_MONTHLY_CENTS,
  BENTLEY_EXPECTED_TIERS,
  PLAN_IDS,
  PS_ID,
  PS_MAIL_ORDER_EST_MONTHLY_CENTS,
  UHC_ID,
  bentleyMedications,
  bentleyPlans,
} from "../../test/fixtures/bentley";

const cellOf = (cells: CellResult[], medicationId: string, planId: string): CellResult => {
  const found = cells.find((c) => c.medicationId === medicationId && c.planId === planId);
  if (!found) throw new Error(`missing cell ${medicationId} × ${planId}`);
  return found;
};

const summaryOf = (output: ReturnType<typeof runAnalysis>, planId: string) => {
  const found = output.summaries.find((s) => s.planId === planId);
  if (!found) throw new Error(`missing summary ${planId}`);
  return found;
};

const med = (overrides: Partial<EngineMedication>): EngineMedication => ({
  id: "med-x",
  name: "Medication X",
  normalizedName: null,
  rxcuis: [],
  relatedRxcuis: [],
  genericOk: true,
  prn: false,
  quantity: 30,
  daysSupply: 30,
  ...overrides,
});

const entry = (overrides: Partial<EngineFormularyEntry>): EngineFormularyEntry => ({
  id: "entry-x",
  rawDrugName: "drug x",
  normalizedName: null,
  rxcuis: [],
  isBrand: false,
  tier: 1,
  pa: false,
  st: false,
  qlQuantity: null,
  qlDays: null,
  extraFlags: [],
  ...overrides,
});

// ── The Bentley grid, cell by cell ──────────────────────────────────────────

describe("Bentley reproduction — drug × plan grid", () => {
  const output = runAnalysis(bentleyMedications, bentleyPlans);

  it("produces one cell per medication per plan (9 × 3)", () => {
    expect(output.cells).toHaveLength(27);
  });

  for (const [medicationId, tiers] of Object.entries(BENTLEY_EXPECTED_TIERS)) {
    for (let planIndex = 0; planIndex < PLAN_IDS.length; planIndex++) {
      const planId = PLAN_IDS[planIndex]!;
      it(`${medicationId} on ${planId} → covered at tier ${tiers[planIndex]}`, () => {
        const cell = cellOf(output.cells, medicationId, planId);
        expect(cell.coverage).toBe("covered");
        expect(cell.tier).toBe(tiers[planIndex]);
        expect(cell.matchMethod).toBe("exact_rxcui");
        expect(cell.matchedEntryId).not.toBeNull();
        expect(cell.needsConfirmation).toBe(false);
      });
    }
  }

  it("every plan covers all 9 medications", () => {
    for (const planId of PLAN_IDS) {
      const summary = summaryOf(output, planId);
      expect(summary.coveredCount).toBe(9);
      expect(summary.totalCount).toBe(9);
    }
  });
});

describe("Bentley reproduction — pricing channel per plan", () => {
  const output = runAnalysis(bentleyMedications, bentleyPlans);

  it("UHC (preferred pharmacy, standard-only table) prices via the standard fallback: Estradiol T3 = $47", () => {
    const cell = cellOf(output.cells, "med-estradiol-cream", UHC_ID);
    expect(cell.copayCents).toBe(4700);
    expect(cell.coinsurancePct).toBeNull();
    expect(summaryOf(output, UHC_ID).pricedChannel).toBe("preferred_retail");
  });

  it("UHC T1 = $0 and T2 = $8, matching the UHC benefit table", () => {
    expect(cellOf(output.cells, "med-losartan", UHC_ID).copayCents).toBe(0);
    expect(cellOf(output.cells, "med-lorazepam", UHC_ID).copayCents).toBe(800);
  });

  it("Pacific Source prices from its STANDARD table because Valley Apothecary is standard there", () => {
    // Preferred T2 is $10; standard T2 is $12 — the report shows standard.
    expect(cellOf(output.cells, "med-estradiol-cream", PS_ID).copayCents).toBe(1200);
    expect(cellOf(output.cells, "med-fluticasone", PS_ID).copayCents).toBe(1200);
    expect(summaryOf(output, PS_ID).pricedChannel).toBe("standard_retail");
  });

  it("Pacific Source T4 (Hydrocodone/Acet) is standard coinsurance, not preferred", () => {
    const cell = cellOf(output.cells, "med-hydrocodone-acet", PS_ID);
    expect(cell.copayCents).toBeNull();
    expect(cell.coinsurancePct).toBe(50); // preferred table says 45
  });

  it("Blue Cross prices from its preferred table: Losartan T6 = $0, Lorazepam T1 = $10", () => {
    expect(cellOf(output.cells, "med-losartan", BC_ID).copayCents).toBe(0);
    expect(cellOf(output.cells, "med-lorazepam", BC_ID).copayCents).toBe(1000);
    expect(summaryOf(output, BC_ID).pricedChannel).toBe("preferred_retail");
  });

  it("Blue Cross T3 is 50% coinsurance (Budesonide row's '50% Cost of Medication')", () => {
    const cell = cellOf(output.cells, "med-hydrocodone-acet", BC_ID);
    expect(cell.copayCents).toBeNull();
    expect(cell.coinsurancePct).toBe(50);
  });
});

describe("Bentley reproduction — plan summaries", () => {
  const output = runAnalysis(bentleyMedications, bentleyPlans);

  it("PRN meds are excluded from estMonthlyCents on every plan", () => {
    for (const planId of PLAN_IDS) {
      const summary = summaryOf(output, planId);
      expect(summary.estMonthlyCents).toBe(BENTLEY_EXPECTED_EST_MONTHLY_CENTS[planId]);
      expect(summary.estMonthlyIsPartial).toBe(false);
    }
  });

  it("PRN coinsurance tiers do not null out estMonthlyCents (BC T3 / PS T4 are PRN-only)", () => {
    expect(summaryOf(output, BC_ID).estMonthlyCents).not.toBeNull();
    expect(summaryOf(output, PS_ID).estMonthlyCents).not.toBeNull();
  });

  it("a non-PRN med on a coinsurance tier DOES null estMonthlyCents", () => {
    const meds = bentleyMedications.map((m) =>
      m.id === "med-hydrocodone-acet" ? { ...m, prn: false } : m,
    );
    const summary = summaryOf(runAnalysis(meds, bentleyPlans), BC_ID);
    expect(summary.estMonthlyCents).toBeNull();
  });

  it("restriction counts: UHC PA+QL on Hydrocodone/Acet, PS ST on Tizanidine", () => {
    const uhc = summaryOf(output, UHC_ID);
    expect([uhc.paCount, uhc.stCount, uhc.qlCount]).toEqual([1, 0, 1]);
    const ps = summaryOf(output, PS_ID);
    expect([ps.paCount, ps.stCount, ps.qlCount]).toEqual([0, 1, 0]);
    const bc = summaryOf(output, BC_ID);
    expect([bc.paCount, bc.stCount, bc.qlCount]).toEqual([0, 0, 0]);
  });

  it("cells carry restrictions verbatim (UHC opioid: PA; QL (60 per 30 days); NEDS)", () => {
    const cell = cellOf(output.cells, "med-hydrocodone-acet", UHC_ID);
    expect(cell.restrictions).toEqual({
      pa: true,
      st: false,
      ql: { quantity: 60, days: 30 },
      extraFlags: ["NEDS"],
    });
  });
});

// ── Coverage-gap behavior ───────────────────────────────────────────────────

describe("medication absent from one plan's formulary", () => {
  it("is not_on_formulary ONLY on that plan", () => {
    const plans = structuredClone(bentleyPlans);
    const bc = plans.find((p) => p.id === BC_ID)!;
    bc.entries = bc.entries.filter((e) => e.id !== "bc-med-losartan");

    const output = runAnalysis(bentleyMedications, plans);
    const bcCell = cellOf(output.cells, "med-losartan", BC_ID);
    expect(bcCell.coverage).toBe("not_on_formulary");
    expect(bcCell.matchMethod).toBe("none");
    expect(bcCell.matchedEntryId).toBeNull();
    expect(bcCell.tier).toBeNull();
    expect(bcCell.restrictions).toBeNull();
    expect(bcCell.copayCents).toBeNull();

    expect(cellOf(output.cells, "med-losartan", UHC_ID).coverage).toBe("covered");
    expect(cellOf(output.cells, "med-losartan", PS_ID).coverage).toBe("covered");
    expect(summaryOf(output, BC_ID).coveredCount).toBe(8);
  });
});

// ── Brand/generic crosswalk (Budesonide/Formoterol scenario) ────────────────

describe("brand/generic crosswalk", () => {
  const brandEntry = entry({
    id: "entry-symbicort",
    rawDrugName: "SYMBICORT",
    normalizedName: null,
    rxcuis: ["352050"],
    isBrand: true,
    tier: 3,
  });
  const genericEntry = entry({
    id: "entry-generic-equiv",
    rawDrugName: "equivalent oral inhaler",
    normalizedName: "equivalent 160/4.5 mcg inhaler",
    rxcuis: ["352050"],
    isBrand: false,
    tier: 2,
  });
  const budesonide = med({
    id: "med-budesonide",
    name: "Budesonide/Formoterol",
    normalizedName: null,
    rxcuis: ["1234567"],
    relatedRxcuis: ["352050"],
  });

  it("generic not on formulary, brand is → covered_equivalent via brand (UHC Budesonide cell)", () => {
    const plan: EnginePlan = {
      ...structuredClone(bentleyPlans[0]!),
      entries: [brandEntry],
    };
    const output = runAnalysis([budesonide], [plan]);
    const cell = cellOf(output.cells, "med-budesonide", plan.id);
    expect(cell.coverage).toBe("covered_equivalent");
    expect(cell.matchMethod).toBe("brand_generic_crosswalk");
    expect(cell.tier).toBe(3);
    expect(cell.copayCents).toBe(4700); // "$47 -T3 (Brand)"
    expect(cell.substitutionNote).toBe("Generic is Not Cov · covered as brand (SYMBICORT)");
  });

  it("genericOk=false blocks the generic crosswalk", () => {
    const brandRequired = med({
      id: "med-brand-required",
      name: "Brandmed",
      normalizedName: null,
      rxcuis: ["9990"],
      relatedRxcuis: ["352050"],
      genericOk: false,
    });
    expect(matchMedication(brandRequired, [genericEntry])).toBeNull();
  });

  it("genericOk=false still allows a BRAND crosswalk match", () => {
    const brandRequired = med({
      id: "med-brand-required",
      name: "Brandmed",
      normalizedName: null,
      rxcuis: ["9990"],
      relatedRxcuis: ["352050"],
      genericOk: false,
    });
    const match = matchMedication(brandRequired, [brandEntry]);
    expect(match?.method).toBe("brand_generic_crosswalk");
    expect(match?.entry.id).toBe("entry-symbicort");
  });

  it("genericOk=true takes the generic equivalent with a substitution note", () => {
    const genericOkMed = med({
      id: "med-generic-ok",
      name: "Brandmed",
      normalizedName: null,
      rxcuis: ["9990"],
      relatedRxcuis: ["352050"],
      genericOk: true,
    });
    const match = matchMedication(genericOkMed, [genericEntry]);
    expect(match?.method).toBe("brand_generic_crosswalk");
    expect(match?.substitutionNote).toBe(
      "Covered as generic equivalent (equivalent oral inhaler)",
    );
  });
});

// ── Match-method ladder ─────────────────────────────────────────────────────

describe("matchMedication ladder", () => {
  it("ingredient+strength+form containment matches when RXCUIs do not intersect", () => {
    const losartan = med({
      id: "m",
      normalizedName: "losartan potassium 50 mg oral tablet",
      rxcuis: ["111"],
    });
    const e = entry({
      id: "e",
      rxcuis: ["222"],
      normalizedName: "losartan potassium 50 mg oral tablet film coated",
    });
    const match = matchMedication(losartan, [e]);
    expect(match?.method).toBe("ingredient_strength_form");
    expect(match?.needsConfirmation).toBe(false);
  });

  it("fuzzy name match flags needsConfirmation", () => {
    const rosuvastatin = med({
      id: "med-rosuvastatin",
      name: "Rosuvastatin Calcium 10mg",
      normalizedName: null,
      rxcuis: ["999"],
    });
    const e = entry({
      id: "entry-rosuvastatin",
      rawDrugName: "rosuvastatin calcium oral tablet 10 mg",
      rxcuis: ["888"],
      tier: 2,
    });
    const match = matchMedication(rosuvastatin, [e]);
    expect(match?.method).toBe("fuzzy_name");
    expect(match?.needsConfirmation).toBe(true);

    const plan: EnginePlan = { ...structuredClone(bentleyPlans[0]!), entries: [e] };
    const cell = cellOf(runAnalysis([rosuvastatin], [plan]).cells, "med-rosuvastatin", plan.id);
    expect(cell.coverage).toBe("covered");
    expect(cell.needsConfirmation).toBe(true);
  });

  it("no match of any kind → null", () => {
    const m = med({ id: "m", name: "Ziprasidone", rxcuis: ["1"], normalizedName: null });
    expect(matchMedication(m, [entry({ rxcuis: ["2"], rawDrugName: "metformin" })])).toBeNull();
  });
});

// ── Channel resolution and overrides ────────────────────────────────────────

describe("resolveChannel", () => {
  it("maps pharmacy status to channel", () => {
    expect(resolveChannel("preferred", null)).toBe("preferred_retail");
    expect(resolveChannel("standard", null)).toBe("standard_retail");
    expect(resolveChannel("out_of_network", null)).toBeNull();
    expect(resolveChannel(null, null)).toBe("preferred_retail"); // "(most efficient)"
  });

  it("override wins over pharmacy status", () => {
    expect(resolveChannel("standard", "mail_order")).toBe("mail_order");
    expect(resolveChannel("out_of_network", "standard_retail")).toBe("standard_retail");
  });
});

describe("channelOverride mail_order", () => {
  it("reprices Pacific Source from its 90-day mail table, normalized ÷3 to a 30-day month", () => {
    const ps = bentleyPlans.find((p) => p.id === PS_ID)!;
    const output = runAnalysis(bentleyMedications, [ps], "mail_order");

    const cell = cellOf(output.cells, "med-estradiol-cream", PS_ID);
    expect(cell.copayCents).toBe(2400); // raw 90-day copay on the cell

    const summary = summaryOf(output, PS_ID);
    expect(summary.pricedChannel).toBe("mail_order");
    // 4 non-PRN T2 meds × ($24 / 3) + 2 T1 meds × $0 = $32
    expect(summary.estMonthlyCents).toBe(PS_MAIL_ORDER_EST_MONTHLY_CENTS);
    expect(summary.estMonthlyIsPartial).toBe(false);
  });

  it("a plan with no mail_order table gets no price (partial estimate, no retail fallback)", () => {
    const uhc = bentleyPlans.find((p) => p.id === UHC_ID)!;
    const output = runAnalysis(bentleyMedications, [uhc], "mail_order");
    expect(cellOf(output.cells, "med-losartan", UHC_ID).copayCents).toBeNull();
    expect(summaryOf(output, UHC_ID).estMonthlyIsPartial).toBe(true);
  });
});

describe("out_of_network pharmacy", () => {
  it("resolves no channel → every cell unpriced, summary marked partial", () => {
    const ps = structuredClone(bentleyPlans.find((p) => p.id === PS_ID)!);
    ps.clientPharmacyStatus = "out_of_network";
    const output = runAnalysis(bentleyMedications, [ps]);

    for (const medication of bentleyMedications) {
      const cell = cellOf(output.cells, medication.id, PS_ID);
      expect(cell.coverage).toBe("covered"); // still on formulary
      expect(cell.copayCents).toBeNull();
      expect(cell.coinsurancePct).toBeNull();
    }
    const summary = summaryOf(output, PS_ID);
    expect(summary.estMonthlyIsPartial).toBe(true);
    expect(summary.estMonthlyCents).toBe(0); // nothing priceable was added
    expect(summary.pricedChannel).toBe("standard_retail"); // display fallback
  });
});

// ── findTierCost fallbacks ──────────────────────────────────────────────────

describe("findTierCost", () => {
  const uhcCosts = bentleyPlans.find((p) => p.id === UHC_ID)!.tierCosts;
  const bcCosts = bentleyPlans.find((p) => p.id === BC_ID)!.tierCosts;
  const psCosts = bentleyPlans.find((p) => p.id === PS_ID)!.tierCosts;

  it("preferred request falls back to a standard-only table (UHC)", () => {
    const cost = findTierCost(uhcCosts, 2, "preferred_retail");
    expect(cost?.channel).toBe("standard_retail");
    expect(cost?.copayCents).toBe(800);
  });

  it("standard request falls back to a preferred-only table (Blue Cross)", () => {
    const cost = findTierCost(bcCosts, 1, "standard_retail");
    expect(cost?.channel).toBe("preferred_retail");
    expect(cost?.copayCents).toBe(1000);
  });

  it("exact channel wins when both exist (Pacific Source)", () => {
    expect(findTierCost(psCosts, 2, "standard_retail")?.copayCents).toBe(1200);
    expect(findTierCost(psCosts, 2, "preferred_retail")?.copayCents).toBe(1000);
  });

  it("mail_order never falls back to retail tables", () => {
    expect(findTierCost(uhcCosts, 2, "mail_order")).toBeNull();
    // PS has mail rows for t1/t2/t4 but not t3:
    expect(findTierCost(psCosts, 3, "mail_order")).toBeNull();
  });

  it("returns null when the tier exists in no table", () => {
    expect(findTierCost(uhcCosts, 6, "preferred_retail")).toBeNull();
  });
});

describe("tierFromNumber", () => {
  it("maps 1–6", () => {
    expect(tierFromNumber(1)).toBe("t1");
    expect(tierFromNumber(6)).toBe("t6");
  });

  it("throws on 0", () => {
    expect(() => tierFromNumber(0)).toThrow(/out of range/);
  });

  it("throws on 7", () => {
    expect(() => tierFromNumber(7)).toThrow(/out of range/);
  });
});
