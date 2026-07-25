import { describe, expect, it } from "vitest";
import { parsePharmacyText } from "./parse";

describe("parsePharmacyText", () => {
  it("parses the canonical RxC form: name - street city ST ZIP", () => {
    const parsed = parsePharmacyText("The Drug Store - 91 E Croy Hailey ID 83333");
    expect(parsed).toEqual({
      name: "The Drug Store",
      street: "91 E Croy",
      city: "Hailey",
      state: "ID",
      zip: "83333",
      raw: "The Drug Store - 91 E Croy Hailey ID 83333",
    });
  });

  it("returns name-only for strings without an address", () => {
    const parsed = parsePharmacyText("Valley Apothecary");
    expect(parsed.name).toBe("Valley Apothecary");
    expect(parsed.street).toBeNull();
    expect(parsed.city).toBeNull();
    expect(parsed.state).toBeNull();
    expect(parsed.zip).toBeNull();
  });

  it("does not split a name containing digits when no address signal follows", () => {
    const parsed = parsePharmacyText("CVS Pharmacy 16932");
    expect(parsed.name).toBe("CVS Pharmacy 16932");
    expect(parsed.zip).toBeNull();
  });

  it("splits at the street number when there is no dash but a zip is present", () => {
    const parsed = parsePharmacyText("Walgreens 123 Main St Boise ID 83702");
    expect(parsed.name).toBe("Walgreens");
    expect(parsed.street).toBe("123 Main St");
    expect(parsed.city).toBe("Boise");
    expect(parsed.state).toBe("ID");
    expect(parsed.zip).toBe("83702");
  });

  it("handles comma-delimited addresses with multi-word cities", () => {
    const parsed = parsePharmacyText(
      "Ridley's Pharmacy - 1863 Blue Lakes Blvd, Twin Falls, ID 83301",
    );
    expect(parsed.name).toBe("Ridley's Pharmacy");
    expect(parsed.street).toBe("1863 Blue Lakes Blvd");
    expect(parsed.city).toBe("Twin Falls");
    expect(parsed.state).toBe("ID");
    expect(parsed.zip).toBe("83301");
  });

  it("handles missing zip and street", () => {
    const parsed = parsePharmacyText("The Drug Store - Hailey ID");
    expect(parsed.name).toBe("The Drug Store");
    expect(parsed.street).toBeNull();
    expect(parsed.city).toBe("Hailey");
    expect(parsed.state).toBe("ID");
    expect(parsed.zip).toBeNull();
  });

  it("truncates zip+4 to five digits", () => {
    const parsed = parsePharmacyText("Sav-On - 100 Main St Boise ID 83702-1234");
    expect(parsed.zip).toBe("83702");
  });

  it("keeps the verbatim raw string", () => {
    const raw = "  The Drug Store -   91 E Croy Hailey ID 83333 ";
    expect(parsePharmacyText(raw).raw).toBe(raw);
  });

  it("handles empty input", () => {
    const parsed = parsePharmacyText("   ");
    expect(parsed.name).toBe("");
    expect(parsed.zip).toBeNull();
  });

  it("parses a street-only tail after the dash", () => {
    const parsed = parsePharmacyText("Custer Drug - 501 Main");
    expect(parsed.name).toBe("Custer Drug");
    expect(parsed.street).toBe("501 Main");
    expect(parsed.city).toBeNull();
  });
});
