import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  chainPattern,
  chainPatterns,
  parseCarrierWorkbook,
  parseCostCell,
  parseDaysSupply,
  parseDeductibleCell,
  parseNetworkStatus,
  readWorkbook,
} from "./workbook";

const fixture = () =>
  readWorkbook(
    new Uint8Array(
      readFileSync(new URL("../../test/fixtures/workbooks/bci-2026.xlsx", import.meta.url)),
    ),
  );

describe("parseCostCell", () => {
  it("parses plain copays", () => {
    expect(parseCostCell("$0")).toMatchObject({ copayCents: 0, coinsurancePct: null });
    expect(parseCostCell("$6")).toMatchObject({ copayCents: 600 });
    expect(parseCostCell("$47")).toMatchObject({ copayCents: 4700 });
  });

  it("parses copay with insulin cap", () => {
    expect(parseCostCell("$40 ($35 insulin)")).toMatchObject({
      copayCents: 4000,
      insulinCapCents: 3500,
    });
  });

  it("parses coinsurance, with and without insulin cap", () => {
    expect(parseCostCell("25% of cost ($35 insulin)")).toMatchObject({
      copayCents: null,
      coinsurancePct: 25,
      insulinCapCents: 3500,
    });
    expect(parseCostCell("28% of cost")).toMatchObject({ coinsurancePct: 28 });
  });

  it("handles not covered and blanks", () => {
    expect(parseCostCell("Not covered")).toMatchObject({ covered: false });
    expect(parseCostCell("")).toBeNull();
    expect(parseCostCell(undefined)).toBeNull();
  });
});

describe("cell helpers", () => {
  it("parses supply and deductible cells", () => {
    expect(parseDaysSupply("Up to 30-day supply")).toBe(30);
    expect(parseDaysSupply("Up to 100-day supply")).toBe(100);
    expect(parseDeductibleCell("Yes — $175 first")).toEqual({
      applies: true,
      deductibleCents: 17500,
    });
    expect(parseDeductibleCell("No")).toEqual({ applies: false, deductibleCents: null });
  });

  it("maps network status vocabulary", () => {
    expect(parseNetworkStatus("Preferred")).toBe("preferred");
    expect(parseNetworkStatus("Standard")).toBe("standard");
    expect(parseNetworkStatus("Out of network")).toBe("out_of_network");
    expect(parseNetworkStatus("Evidence / notes")).toBeNull();
  });

  it("derives chain match patterns", () => {
    expect(chainPattern("Sav-On Pharmacy (inside Albertsons)")).toBe("Sav-On");
    expect(chainPattern("CVS Pharmacy (retail)")).toBe("CVS");
    expect(chainPattern("CVS Specialty")).toBe("CVS Specialty");
    expect(chainPattern("Walmart Pharmacy")).toBe("Walmart");
  });

  it("extracts brand aliases from naming parentheticals only", () => {
    expect(chainPatterns("Sav-On Pharmacy (inside Albertsons)")).toEqual([
      "Sav-On",
      "Albertsons",
    ]);
    expect(chainPatterns("CVS Pharmacy (retail)")).toEqual(["CVS"]);
    expect(chainPatterns("Albertsons Pharmacy (own branding)")).toEqual(["Albertsons"]);
    expect(chainPatterns("Fred Meyer Pharmacy (part of Kroger)")).toEqual([
      "Fred Meyer",
      "Kroger",
    ]);
  });
});

describe("parseCarrierWorkbook — real BCI 2026 workbook", () => {
  const parsed = parseCarrierWorkbook(fixture());

  it("parses tier pricing for all six plans without warnings", () => {
    expect(parsed.warnings).toEqual([]);
    const plans = new Set(parsed.tierPricing.map((r) => r.planName));
    expect(plans.size).toBe(6);
    expect(plans).toContain("True Blue Rx 32PSP (HMO)");
    // 6 plans × 5 tiers
    expect(parsed.tierPricing).toHaveLength(30);
  });

  it("captures the 32PSP tier rows faithfully", () => {
    const rows = parsed.tierPricing.filter((r) => r.planName === "True Blue Rx 32PSP (HMO)");
    const t1 = rows.find((r) => r.tier === 1);
    expect(t1).toMatchObject({
      tierLabel: "Preferred Generic",
      daysSupply: 100,
      deductibleApplies: false,
    });
    expect(t1?.costs.preferred_retail).toMatchObject({ copayCents: 0 });

    const t3 = rows.find((r) => r.tier === 3);
    expect(t3).toMatchObject({ deductibleApplies: true, deductibleCents: 17500 });
    expect(t3?.costs.preferred_retail).toMatchObject({ copayCents: 4000, insulinCapCents: 3500 });
    expect(t3?.costs.standard_retail).toMatchObject({ copayCents: 4700 });
    expect(t3?.costs.standard_mail).toMatchObject({ copayCents: 4000 });

    const t5 = rows.find((r) => r.tier === 5);
    expect(t5?.costs.preferred_retail).toMatchObject({ coinsurancePct: 28 });
  });

  it("parses the pharmacy network rules with specific chains first", () => {
    const byLabel = new Map(parsed.networkRules.map((r) => [r.label, r]));
    expect(byLabel.get("Sav-On Pharmacy (inside Albertsons)")?.status).toBe("preferred");
    expect(byLabel.get("CVS Specialty")?.status).toBe("out_of_network");
    expect(byLabel.get("Walgreens")?.status ?? byLabel.get("Walgreens Pharmacy")?.status).toBe(
      "standard",
    );
    const cvsSpecialtyIdx = parsed.networkRules.findIndex((r) => r.label === "CVS Specialty");
    const cvsRetailIdx = parsed.networkRules.findIndex((r) => r.label === "CVS Pharmacy (retail)");
    expect(cvsSpecialtyIdx).toBeGreaterThanOrEqual(0);
    expect(cvsRetailIdx).toBeGreaterThanOrEqual(0);
    expect(cvsSpecialtyIdx).toBeLessThan(cvsRetailIdx);
  });
});
