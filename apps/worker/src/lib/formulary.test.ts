import { describe, expect, it } from "vitest";
import { expandStrengths, isBrandName, normalizeDrugName } from "./formulary";

describe("isBrandName", () => {
  it("treats fully uppercase rows as brand", () => {
    expect(isBrandName("ALECENSA")).toBe(true);
    expect(isBrandName("JANUVIA 100 MG")).toBe(true);
  });

  it("treats lowercase rows as generic", () => {
    expect(isBrandName("cyclophosphamide oral capsule")).toBe(false);
    expect(isBrandName("tramadol hcl oral tablet 50 mg")).toBe(false);
  });

  it("mixed case is not brand", () => {
    expect(isBrandName("Eliquis")).toBe(false);
  });

  it("no letters is not brand", () => {
    expect(isBrandName("123")).toBe(false);
  });
});

describe("normalizeDrugName", () => {
  it("lowercases and collapses whitespace", () => {
    expect(normalizeDrugName("  ALECENSA   150 MG ")).toBe("alecensa 150 mg");
  });
});

describe("expandStrengths", () => {
  it("expands the Discovery-doc multi-strength example", () => {
    expect(
      expandStrengths(
        "morphine sulfate er oral tablet extended release 15 mg, 30 mg, 60 mg",
      ),
    ).toEqual([
      "morphine sulfate er oral tablet extended release 15 mg",
      "morphine sulfate er oral tablet extended release 30 mg",
      "morphine sulfate er oral tablet extended release 60 mg",
    ]);
  });

  it("inherits a trailing unit for bare-number strengths", () => {
    expect(expandStrengths("metformin hcl oral tablet 500, 850, 1000 mg")).toEqual([
      "metformin hcl oral tablet 500 mg",
      "metformin hcl oral tablet 850 mg",
      "metformin hcl oral tablet 1000 mg",
    ]);
  });

  it("handles decimal strengths", () => {
    expect(expandStrengths("apixaban oral tablet 2.5 mg, 5 mg")).toEqual([
      "apixaban oral tablet 2.5 mg",
      "apixaban oral tablet 5 mg",
    ]);
  });

  it("returns a single normalized name when there is no strength list", () => {
    expect(expandStrengths("meloxicam oral tablet")).toEqual(["meloxicam oral tablet"]);
    expect(expandStrengths("tramadol hcl oral tablet 50 mg")).toEqual([
      "tramadol hcl oral tablet 50 mg",
    ]);
  });

  it("does not expand commas that are not strength lists", () => {
    expect(expandStrengths("neomycin, polymyxin b sulfates ointment")).toEqual([
      "neomycin, polymyxin b sulfates ointment",
    ]);
  });

  it("does not expand when the first segment has no trailing strength", () => {
    expect(expandStrengths("some drug name, 30")).toEqual(["some drug name, 30"]);
  });

  it("normalizes casing on expansion", () => {
    expect(expandStrengths("ALECENSA 150 MG, 300 MG")).toEqual([
      "alecensa 150 mg",
      "alecensa 300 mg",
    ]);
  });
});
