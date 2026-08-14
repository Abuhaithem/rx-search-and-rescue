import { describe, expect, it } from "vitest";
import { derivePharmacyBrandName, normalizePharmacyBrandName } from "./brand";

describe("derivePharmacyBrandName", () => {
  it("strips store-number suffixes", () => {
    expect(derivePharmacyBrandName("Walgreens Pharmacy #10603")).toBe("Walgreens Pharmacy");
    expect(derivePharmacyBrandName("Costco Pharmacy #761")).toBe("Costco Pharmacy");
    expect(derivePharmacyBrandName("Sav-On Pharmacy # 154")).toBe("Sav-On Pharmacy");
  });

  it("strips parenthetical location suffixes", () => {
    expect(derivePharmacyBrandName("Fred Meyer Pharmacy (Franklin Rd)")).toBe(
      "Fred Meyer Pharmacy",
    );
  });

  it("strips both when combined", () => {
    expect(derivePharmacyBrandName("Ridley's Pharmacy #7162 (Main St)")).toBe(
      "Ridley's Pharmacy #7162",
    );
    expect(derivePharmacyBrandName("Ridley's Pharmacy (Main St) #7162")).toBe(
      "Ridley's Pharmacy",
    );
  });

  it("keeps independents as their own brand", () => {
    expect(derivePharmacyBrandName("Wallace Drug")).toBe("Wallace Drug");
    expect(derivePharmacyBrandName("Power County Hospital District Pharmacy")).toBe(
      "Power County Hospital District Pharmacy",
    );
  });

  it("does not strip mid-name numbers or street nicknames", () => {
    expect(derivePharmacyBrandName("Albertsons Pharmacy 16th & State")).toBe(
      "Albertsons Pharmacy 16th & State",
    );
  });

  it("falls back to the original when stripping would empty the name", () => {
    expect(derivePharmacyBrandName("#12")).toBe("#12");
  });

  it("normalizes case for the grouping key", () => {
    expect(normalizePharmacyBrandName("WALGREENS Pharmacy #13672")).toBe("walgreens pharmacy");
  });
});
