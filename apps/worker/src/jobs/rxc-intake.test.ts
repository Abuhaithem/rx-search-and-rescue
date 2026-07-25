import { describe, expect, it } from "vitest";
import type { ExtractedPolicy } from "@rxsr/core/intake";
import { pickCurrentDrugPlanIndex } from "./rxc-intake";

const policy = (policyType: ExtractedPolicy["policyType"]): ExtractedPolicy => ({
  rawText: `raw-${policyType}`,
  carrierName: null,
  policyNumber: null,
  policyType,
});

describe("pickCurrentDrugPlanIndex", () => {
  it("prefers pdp over ma_pd", () => {
    expect(
      pickCurrentDrugPlanIndex([policy("ma_pd"), policy("pdp")]),
    ).toBe(1);
  });

  it("falls back to ma_pd when no pdp exists", () => {
    expect(
      pickCurrentDrugPlanIndex([policy("med_supp"), policy("ma_pd")]),
    ).toBe(1);
  });

  it("never selects med_supp or other", () => {
    expect(pickCurrentDrugPlanIndex([policy("med_supp"), policy("other")])).toBe(-1);
  });

  it("handles the Healy sample: Humana PDP + MODA Med Supp", () => {
    const policies: ExtractedPolicy[] = [
      {
        rawText: "Humana - H94324997 - PDP",
        carrierName: "Humana",
        policyNumber: "H94324997",
        policyType: "pdp",
      },
      {
        rawText: "MODA - T02330968 - Med Supp",
        carrierName: "MODA",
        policyNumber: "T02330968",
        policyType: "med_supp",
      },
    ];
    expect(pickCurrentDrugPlanIndex(policies)).toBe(0);
  });

  it("handles the no-in-force-policies case (Gonzalez sample)", () => {
    expect(pickCurrentDrugPlanIndex([])).toBe(-1);
  });

  it("picks only the first pdp when several exist", () => {
    expect(pickCurrentDrugPlanIndex([policy("pdp"), policy("pdp")])).toBe(0);
  });
});
