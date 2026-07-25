import { describe, expect, it } from "vitest";
import {
  DEFAULT_DEDUCTIBLE_FOOTNOTE,
  TIER_LABELS,
  applyOverrides,
  centsDisplay,
  type ReportModel,
  type ReportOverrideEntry,
} from "./index";

const makeModel = (): ReportModel => ({
  clientName: "Bentley, Barb",
  clientExternalId: "37719004445",
  planYear: 2026,
  preparedBy: "Seid",
  agencyName: "Test Agency",
  preparedDate: "2026-07-21",
  pharmacyNotes: [
    "Valley Apothecary — Standard Pricing on the Pacific Source plan.",
  ],
  agentNotes: "All doctors are In Network for all plans",
  planNames: ["UHC 0009", "Blue Cross Essentials", "Pac Source MyCare 24"],
  currentPlanIndex: 0,
  grid: [
    {
      medicationName: "Losartan",
      cells: [
        { display: "T1", coverage: "covered", overridden: false },
        { display: "T6", coverage: "covered", overridden: false },
        { display: "T1", coverage: "covered", overridden: false },
      ],
    },
    {
      medicationName: "Budesonide/Formoterol",
      cells: [
        { display: "Generic is Not Cov · $47 -T3 (Brand)", coverage: "covered_equivalent", overridden: false },
        { display: "50% Cost of Medication", coverage: "covered", overridden: false },
        { display: "30% Cost of Medication", coverage: "covered", overridden: false },
      ],
    },
  ],
  benefits: [],
  deductibleFootnote: null,
  disclaimer: null,
});

describe("applyOverrides", () => {
  it("replaces agentNotes", () => {
    const out = applyOverrides(makeModel(), [
      { path: "agentNotes", value: "Dr. Anderson – Eyes – what is first name?" },
    ]);
    expect(out.agentNotes).toBe("Dr. Anderson – Eyes – what is first name?");
  });

  it("grid.<row>.<col>.display override sets the display and flags overridden", () => {
    const out = applyOverrides(makeModel(), [
      { path: "grid.0.1.display", value: "$0 -T6" },
    ]);
    expect(out.grid[0]!.cells[1]).toEqual({
      display: "$0 -T6",
      coverage: "covered",
      overridden: true,
    });
    // neighbors untouched
    expect(out.grid[0]!.cells[0]!.overridden).toBe(false);
    expect(out.grid[0]!.cells[2]!.overridden).toBe(false);
    expect(out.grid[1]!.cells[1]!.overridden).toBe(false);
  });

  it("replaces deductibleFootnote", () => {
    const out = applyOverrides(makeModel(), [
      { path: "deductibleFootnote", value: "Custom footnote" },
    ]);
    expect(out.deductibleFootnote).toBe("Custom footnote");
  });

  it("applies multiple overrides in one pass", () => {
    const out = applyOverrides(makeModel(), [
      { path: "agentNotes", value: "Updated" },
      { path: "grid.1.0.display", value: "Not Covered" },
    ]);
    expect(out.agentNotes).toBe("Updated");
    expect(out.grid[1]!.cells[0]!.display).toBe("Not Covered");
    expect(out.grid[1]!.cells[0]!.overridden).toBe(true);
  });

  it.each<ReportOverrideEntry>([
    { path: "somethingElse", value: "x" },
    { path: "grid.99.0.display", value: "x" },
    { path: "grid.0.99.display", value: "x" },
    { path: "grid.nope.nope.display", value: "x" },
    { path: "grid.0.0.display", value: 42 }, // non-string value ignored
    { path: "agentNotes", value: 42 }, // non-string value ignored
    { path: "", value: "x" },
  ])("ignores unknown/invalid override %j harmlessly", (override) => {
    const out = applyOverrides(makeModel(), [override]);
    expect(out).toEqual(makeModel());
  });

  it("does not mutate the original model", () => {
    const original = makeModel();
    const before = structuredClone(original);
    applyOverrides(original, [
      { path: "agentNotes", value: "changed" },
      { path: "grid.0.0.display", value: "changed" },
    ]);
    expect(original).toEqual(before);
  });

  it("returns a deep copy even with zero overrides", () => {
    const original = makeModel();
    const out = applyOverrides(original, []);
    expect(out).toEqual(original);
    expect(out).not.toBe(original);
    expect(out.grid[0]).not.toBe(original.grid[0]);
  });
});

describe("DEFAULT_DEDUCTIBLE_FOOTNOTE", () => {
  it("matches the real report footnote for [3, 4, 5]", () => {
    expect(DEFAULT_DEDUCTIBLE_FOOTNOTE([3, 4, 5])).toBe(
      "RX Deductible applies to Tier 3, Tier 4 and Tier 5 medications on all plans",
    );
  });

  it("single tier [3]", () => {
    expect(DEFAULT_DEDUCTIBLE_FOOTNOTE([3])).toBe(
      "RX Deductible applies to Tier 3 medications on all plans",
    );
  });

  it("two tiers [4, 5] use 'and' with no comma", () => {
    expect(DEFAULT_DEDUCTIBLE_FOOTNOTE([4, 5])).toBe(
      "RX Deductible applies to Tier 4 and Tier 5 medications on all plans",
    );
  });

  it("empty tier list → null (no footnote)", () => {
    expect(DEFAULT_DEDUCTIBLE_FOOTNOTE([])).toBeNull();
  });
});

describe("centsDisplay", () => {
  it('0 → "$0"', () => {
    expect(centsDisplay(0)).toBe("$0");
  });

  it('800 → "$8" (whole dollars drop cents)', () => {
    expect(centsDisplay(800)).toBe("$8");
  });

  it('4750 → "$47.50"', () => {
    expect(centsDisplay(4750)).toBe("$47.50");
  });

  it('4700 → "$47" (UHC T3)', () => {
    expect(centsDisplay(4700)).toBe("$47");
  });

  it('3500 → "$35" (covered insulin)', () => {
    expect(centsDisplay(3500)).toBe("$35");
  });

  it('non-whole cents keep two decimals: 5 → "$0.05"', () => {
    expect(centsDisplay(5)).toBe("$0.05");
  });
});

describe("TIER_LABELS", () => {
  it("covers all seven cost tiers with report labels", () => {
    expect(TIER_LABELS).toEqual({
      t1: "T1",
      t2: "T2",
      t3: "T3",
      t4: "T4",
      t5: "T5",
      t6: "T6",
      insulin: "Covered Insulin",
    });
  });
});
