import { describe, expect, it } from "vitest";
import { editDistanceWithin, fuzzyResolveGeneric, normalizeDrugKey } from "./resolution";

describe("normalizeDrugKey", () => {
  it("reduces brand + dosage text to the molecule key", () => {
    expect(normalizeDrugKey("Zetia TAB 10MG")).toBe("zetia");
    expect(normalizeDrugKey("Eliquis TAB 2.5MG")).toBe("eliquis");
    expect(normalizeDrugKey("losartan potassium oral tablet 50 mg")).toBe("losartan");
  });

  it("keeps combination components, dropping the joiner punctuation", () => {
    expect(normalizeDrugKey("Ezetimibe-Simvastatin (Oral Tablet) 10-20mg")).toBe(
      "ezetimibe simvastatin",
    );
  });

  it("strips salts, routes, and release modifiers", () => {
    expect(normalizeDrugKey("Metoprolol Succinate ER Oral Tablet Extended Release 24 Hour")).toBe(
      "metoprolol",
    );
    expect(normalizeDrugKey("Buprenorphine (Transdermal Patch Weekly)")).toBe("buprenorphine");
  });

  it("strips percentages and per-volume strengths", () => {
    expect(normalizeDrugKey("Diclofenac Sodium 1.5% External Solution")).toBe("diclofenac");
    expect(normalizeDrugKey("Acetaminophen-Codeine 120-12MG/5ML Oral Solution")).toBe(
      "acetaminophen codeine",
    );
  });
});

describe("editDistanceWithin", () => {
  it("computes small distances and rejects those above the budget", () => {
    expect(editDistanceWithin("zetia", "zetia", 2)).toBe(0);
    expect(editDistanceWithin("ezetimibe", "ezetimib", 2)).toBe(1);
    expect(editDistanceWithin("ezetimibe", "atorvastatin", 2)).toBeNull();
  });
});

describe("fuzzyResolveGeneric", () => {
  const index = ["ezetimibe", "atorvastatin", "rosuvastatin", "losartan", "metformin"];

  it("fixes single typos", () => {
    expect(fuzzyResolveGeneric("ezetimib", index)).toBe("ezetimibe");
    expect(fuzzyResolveGeneric("metfromin", index)).toBe("metformin");
  });

  it("refuses ambiguity between near candidates", () => {
    // one edit from both candidates → tie → null
    expect(fuzzyResolveGeneric("aosuvastatin", ["rosuvastatin", "bosuvastatin"])).toBeNull();
  });

  it("never matches very short keys", () => {
    expect(fuzzyResolveGeneric("zia", index)).toBeNull();
  });

  it("does not return exact hits (handled upstream) or far misses", () => {
    expect(fuzzyResolveGeneric("ezetimibe", index)).toBeNull();
    expect(fuzzyResolveGeneric("humira", index)).toBeNull();
  });
});
