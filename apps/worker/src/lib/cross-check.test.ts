import { describe, expect, it } from "vitest";
import type { FormularyRow } from "@rxsr/core/intake";
import { crossCheckFormularyPage, MISMATCH_CONFIDENCE, OK_CONFIDENCE } from "./cross-check";

const row = (rawDrugName: string, tier = 3): FormularyRow => ({
  rawDrugName,
  tier,
  requirementsText: null,
  therapeuticCategory: null,
});

const pageText = [
  "ANTINEOPLASTICS",
  "tramadol hcl oral tablet 50 mg 3 QL (240 per 30 days); NEDS",
  "morphine sulfate er oral tablet 15 mg 3 PA; QL (90 per 30 days)",
  "ALECENSA 5 PA; QL (240 per 30 days); NM",
  "cyclophosphamide oral capsule 3 B/D PA; NM",
  "meloxicam oral tablet 1 —",
].join("\n");

describe("crossCheckFormularyPage", () => {
  it("passes when extracted rows appear in the text layer", () => {
    const rows = [
      row("tramadol hcl oral tablet 50 mg"),
      row("morphine sulfate er oral tablet 15 mg"),
      row("ALECENSA", 5),
      row("cyclophosphamide oral capsule"),
      row("meloxicam oral tablet", 1),
    ];
    const result = crossCheckFormularyPage(rows, pageText);
    expect(result.matchedRows).toBe(5);
    expect(result.overlapRatio).toBe(1);
    expect(result.ok).toBe(true);
  });

  it("fails when the model hallucinated rows not present in the text", () => {
    const rows = [
      row("atorvastatin calcium tablet"),
      row("lisinopril oral tablet"),
      row("sertraline hcl tablet"),
      row("losartan potassium tablet"),
      row("gabapentin capsule"),
    ];
    const result = crossCheckFormularyPage(rows, pageText);
    expect(result.overlapRatio).toBe(0);
    expect(result.ok).toBe(false);
  });

  it("fails when row counts diverge badly", () => {
    const rows = [row("tramadol hcl oral tablet 50 mg")];
    const result = crossCheckFormularyPage(rows, pageText);
    // 1 extracted vs 5 estimated text rows → count check fails
    expect(result.estimatedTextRows).toBe(5);
    expect(result.ok).toBe(false);
  });

  it("skips the row-count check when the text layer has no line structure", () => {
    const flat = pageText.replace(/\n/g, " ");
    const rows = [row("tramadol hcl oral tablet 50 mg")];
    const result = crossCheckFormularyPage(rows, flat);
    expect(result.estimatedTextRows).toBe(0);
    expect(result.ok).toBe(true);
  });

  it("treats empty extraction as trivially ok", () => {
    const result = crossCheckFormularyPage([], "cover page text\nwith no rows\nat all");
    expect(result.overlapRatio).toBe(1);
    expect(result.matchedRows).toBe(0);
  });

  it("exports confidence constants in the expected order", () => {
    expect(OK_CONFIDENCE).toBeGreaterThan(MISMATCH_CONFIDENCE);
  });
});
