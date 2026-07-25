import { describe, expect, it } from "vitest";
import {
  buildChannelColumns,
  buildDeductibleFootnote,
  buildPlanBenefits,
  formatCoinsurance,
  formatGridCellDisplay,
  formatMedicationName,
  pharmacyNote,
  type BenefitTierCost,
} from "./display";

const cell = (over: Partial<Parameters<typeof formatGridCellDisplay>[0]> = {}) => ({
  coverage: "covered" as const,
  tier: 2,
  copayCents: 800,
  coinsurancePct: null,
  substitutionNote: null,
  ...over,
});

describe("formatGridCellDisplay", () => {
  it("covered copay → '$8 -T2'", () => {
    expect(formatGridCellDisplay(cell())).toBe("$8 -T2");
  });

  it("non-round copay keeps cents → '$47.50 -T3'", () => {
    expect(formatGridCellDisplay(cell({ tier: 3, copayCents: 4750 }))).toBe("$47.50 -T3");
  });

  it("coinsurance → '50% Cost of Medication'", () => {
    expect(formatGridCellDisplay(cell({ copayCents: null, coinsurancePct: 50 }))).toBe(
      "50% Cost of Medication",
    );
  });

  it("covered without pricing falls back to tier", () => {
    expect(formatGridCellDisplay(cell({ copayCents: null }))).toBe("T2");
  });

  it("not_on_formulary / not_covered → 'Not Covered'", () => {
    expect(formatGridCellDisplay(cell({ coverage: "not_on_formulary" }))).toBe("Not Covered");
    expect(formatGridCellDisplay(cell({ coverage: "not_covered" }))).toBe("Not Covered");
  });

  it("covered_equivalent brand crosswalk → 'Generic is Not Cov · $47 -T3 (Brand)'", () => {
    expect(
      formatGridCellDisplay(
        cell({
          coverage: "covered_equivalent",
          tier: 3,
          copayCents: 4700,
          substitutionNote: "Generic is Not Cov · covered as brand (ELIQUIS)",
        }),
      ),
    ).toBe("Generic is Not Cov · $47 -T3 (Brand)");
  });

  it("covered_equivalent generic crosswalk → '$8 -T2 (Generic)'", () => {
    expect(
      formatGridCellDisplay(
        cell({
          coverage: "covered_equivalent",
          substitutionNote: "Covered as generic equivalent (apixaban)",
        }),
      ),
    ).toBe("$8 -T2 (Generic)");
  });
});

describe("formatCoinsurance", () => {
  it("drops trailing zeros", () => {
    expect(formatCoinsurance(50)).toBe("50%");
    expect(formatCoinsurance(33.33)).toBe("33.33%");
    expect(formatCoinsurance(25.5)).toBe("25.5%");
  });
});

describe("formatMedicationName", () => {
  it("suffixes PRN meds", () => {
    expect(formatMedicationName("Hydrocodone/Acet", true)).toBe("Hydrocodone/Acet (prn)");
    expect(formatMedicationName("Eliquis", false)).toBe("Eliquis");
  });
});

const tc = (
  channel: BenefitTierCost["channel"],
  tier: BenefitTierCost["tier"],
  copayCents: number | null,
  coinsurancePct: number | null = null,
  daysSupply = channel === "mail_order" ? 90 : 30,
): BenefitTierCost => ({ channel, tier, daysSupply, copayCents, coinsurancePct });

describe("buildChannelColumns", () => {
  it("both retail networks → Standard + Preferred headers", () => {
    const { channels, headers } = buildChannelColumns(
      [tc("standard_retail", "t1", 100), tc("preferred_retail", "t1", 0)],
      false,
    );
    expect(channels).toEqual(["standard_retail", "preferred_retail"]);
    expect(headers).toEqual(["30 DAY Standard", "30 Day Preferred"]);
  });

  it("single retail network → In Network header", () => {
    const { headers } = buildChannelColumns([tc("standard_retail", "t1", 0)], false);
    expect(headers).toEqual(["30 DAY In Network"]);
  });

  it("mail order only appears when the analysis priced with it", () => {
    const costs = [tc("standard_retail", "t1", 0), tc("mail_order", "t1", 0)];
    expect(buildChannelColumns(costs, false).channels).toEqual(["standard_retail"]);
    expect(buildChannelColumns(costs, true).channels).toEqual(["standard_retail", "mail_order"]);
    expect(buildChannelColumns(costs, true).headers[1]).toBe("90 DAY Mail Order");
  });
});

describe("buildPlanBenefits", () => {
  it("builds tier rows with copays, coinsurance and gaps", () => {
    const benefits = buildPlanBenefits({
      planName: "True Blue Rx 33",
      carrierName: "Blue Cross of Idaho",
      premiumCents: 0,
      rxDeductibleCents: 34000,
      includeMailOrder: false,
      tierCosts: [
        tc("standard_retail", "t1", 100),
        tc("preferred_retail", "t1", 0),
        tc("standard_retail", "t3", 4700),
        tc("standard_retail", "t4", null, 100),
        tc("preferred_retail", "insulin", 3500),
      ],
    });
    expect(benefits.premium).toBe("$0.00");
    expect(benefits.rxDeductible).toBe("$340.00");
    expect(benefits.tierRows).toEqual([
      { label: "T1", values: ["$1", "$0"] },
      { label: "T3", values: ["$47", "—"] },
      { label: "T4", values: ["100%", "—"] },
      { label: "Covered Insulin", values: ["—", "$35"] },
    ]);
  });
});

describe("pharmacyNote", () => {
  it("standard pricing note", () => {
    expect(pharmacyNote("The Drug Store", "MyCare 24", "standard")).toBe(
      "The Drug Store — you will receive Standard Pricing on the MyCare 24 plan.",
    );
  });
  it("out of network note", () => {
    expect(pharmacyNote("The Drug Store", "MyCare 24", "out_of_network")).toBe(
      "The Drug Store — is Out of Network on the MyCare 24 plan.",
    );
  });
  it("preferred → no note", () => {
    expect(pharmacyNote("The Drug Store", "MyCare 24", "preferred")).toBeNull();
  });
});

describe("buildDeductibleFootnote", () => {
  it("shared tiers → single 'all plans' sentence", () => {
    expect(
      buildDeductibleFootnote([
        { name: "A", deductibleTiers: [3, 4, 5] },
        { name: "B", deductibleTiers: [5, 3, 4] },
      ]),
    ).toBe("RX Deductible applies to Tier 3, Tier 4 and Tier 5 medications on all plans");
  });

  it("divergent tiers → per-plan sentences", () => {
    expect(
      buildDeductibleFootnote([
        { name: "A", deductibleTiers: [3, 4, 5] },
        { name: "B", deductibleTiers: [4, 5] },
      ]),
    ).toBe(
      "RX Deductible applies to Tier 3, Tier 4 and Tier 5 medications on the A plan. " +
        "RX Deductible applies to Tier 4 and Tier 5 medications on the B plan.",
    );
  });

  it("no deductible tiers anywhere → null", () => {
    expect(buildDeductibleFootnote([{ name: "A", deductibleTiers: [] }])).toBeNull();
  });
});
