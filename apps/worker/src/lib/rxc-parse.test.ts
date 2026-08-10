import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { classifyPolicyType, parseRxcText, splitNameAndDosage } from "./rxc-parse";

/** Fixtures are the real sample exports' text layers; pages joined with \f. */
const fixturePages = (name: string): string[] =>
  readFileSync(
    new URL(`../../test/fixtures/rxc/${name}.txt`, import.meta.url),
    "utf8",
  ).split("\f");

describe("parseRxcText — Healy sample (wrapped table cells, 2 pages)", () => {
  const result = parseRxcText(fixturePages("healy"));

  it("parses the header and pharmacy block", () => {
    expect(result.clientName).toBe("Marilyn Healy");
    expect(result.zip).toBe("83333");
    expect(result.takesPrescriptions).toBe(true);
    expect(result.deliveryPreferred).toBe(false);
    expect(result.preferredPharmacies).toEqual([
      "The Drug Store - 91 E Croy Hailey ID 83333",
    ]);
  });

  it("parses all six structured medications despite cell wrapping", () => {
    expect(result.medications).toHaveLength(6);
    expect(result.medications.map((m) => m.name)).toEqual([
      "atorvastatin calcium",
      "diltiazem hydrochloride er (extended release beads)",
      "Eliquis",
      "losartan potassium",
      "metoprolol succinate er",
      "sertraline hcl",
    ]);
    expect(result.medications.every((m) => m.source === "structured")).toBe(true);
    expect(result.medications.every((m) => m.confidence === 1)).toBe(true);
    expect(result.medications.every((m) => m.genericOk === true)).toBe(true);
  });

  it("reassembles wrapped dosage cells and quantities", () => {
    const byName = new Map(result.medications.map((m) => [m.name, m]));
    expect(byName.get("atorvastatin calcium")).toMatchObject({
      dosageText: "atorvastatin calcium TAB 20MG",
      quantity: 60,
      daysSupply: 60,
    });
    expect(byName.get("diltiazem hydrochloride er (extended release beads)")).toMatchObject({
      dosageText: "diltiazem hydrochloride er (extended release beads) CAP 240MG/24",
      quantity: 90,
      daysSupply: 90,
    });
    expect(byName.get("Eliquis")).toMatchObject({
      dosageText: "Eliquis TAB 2.5MG",
      quantity: 60,
      daysSupply: 30,
    });
    expect(byName.get("metoprolol succinate er")).toMatchObject({
      dosageText: "metoprolol succinate er TAB 50MG ER",
      quantity: 90,
      daysSupply: 60,
    });
  });

  it("parses both in-force policies across the page break", () => {
    expect(result.inForcePolicies).toEqual([
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
    ]);
  });

  it("has no freetext rows (no Additional Information section)", () => {
    expect(result.medications.filter((m) => m.source === "freetext")).toEqual([]);
  });
});

describe("parseRxcText — Gonzalez sample (inline rows, freetext, no policies)", () => {
  const result = parseRxcText(fixturePages("gonzalez"));

  it("parses the header with no preferred pharmacies", () => {
    expect(result.clientName).toBe("Felix Gonzalez");
    expect(result.zip).toBe("83340");
    expect(result.takesPrescriptions).toBe(true);
    expect(result.deliveryPreferred).toBe(false);
    expect(result.preferredPharmacies).toEqual([]);
  });

  it("parses the five structured rows, including the brand/generic split", () => {
    const structured = result.medications.filter((m) => m.source === "structured");
    expect(structured.map((m) => m.name)).toEqual([
      "Cortef",
      "lamotrigine",
      "levothyroxine sodium (tablets)",
      "rosuvastatin calcium",
      "tamsulosin hcl",
    ]);
    // Brand row: dosage column does NOT repeat the medication column.
    expect(structured[0]).toMatchObject({
      dosageText: "hydrocortisone (Tablets) TAB 10MG",
      quantity: 60,
      daysSupply: 30,
    });
    expect(structured[4]).toMatchObject({
      dosageText: "tamsulosin hcl CAP 0.4MG",
      quantity: 180,
      daysSupply: 90,
    });
  });

  it("captures Additional Information as freetext with confidence 0.5", () => {
    const freetext = result.medications.filter((m) => m.source === "freetext");
    expect(freetext).toHaveLength(1);
    const entry = freetext[0];
    expect(entry?.confidence).toBe(0.5);
    expect(entry?.rawText).toContain("sodium chloride 1 GM");
    expect(entry?.rawText).toContain("fluoxetine 10 mg, 180 tab");
    // The glued submit timestamp is stripped.
    expect(entry?.rawText).not.toMatch(/10\/6\/2025/);
  });

  it("returns an empty policy list for 'No in force policies'", () => {
    expect(result.inForcePolicies).toEqual([]);
  });
});

describe("parseRxcText — Smith sample (three policies incl. non-drug)", () => {
  const result = parseRxcText(fixturePages("smith"));

  it("parses medications including slash names and decimal strengths", () => {
    expect(result.medications.map((m) => m.name)).toEqual([
      "amiodarone hydrochloride",
      "carvedilol",
      "Eliquis",
      "lisinopril/hctz",
    ]);
    const byName = new Map(result.medications.map((m) => [m.name, m]));
    expect(byName.get("carvedilol")).toMatchObject({
      dosageText: "carvedilol TAB 3.125MG",
      quantity: 60,
      daysSupply: 30,
    });
    expect(byName.get("lisinopril/hctz")).toMatchObject({
      dosageText: "lisinopril/hctz TAB 20-12.5",
      quantity: 30,
      daysSupply: 30,
    });
  });

  it("classifies all three policies (Dental → other)", () => {
    expect(result.inForcePolicies.map((p) => p.policyType)).toEqual([
      "other",
      "pdp",
      "med_supp",
    ]);
    expect(result.inForcePolicies[0]).toMatchObject({
      carrierName: "Delta Dental",
      policyNumber: "995292099",
    });
  });
});

describe("parseRxcText — failure modes (fallback triggers)", () => {
  it("throws on an empty text layer (scanned PDF)", () => {
    expect(() => parseRxcText([""])).toThrow();
    expect(() => parseRxcText([])).toThrow();
  });

  it("throws when section anchors are missing (layout drift)", () => {
    expect(() => parseRxcText(["Some Client", "totally different layout"])).toThrow(
      /anchors not found/,
    );
  });
});

describe("parseRxcText — Coleman sample (2025+ AgencyBloc revision, completed)", () => {
  const result = parseRxcText(fixturePages("coleman-2026"));

  it("skips the status banner and finds the client name", () => {
    expect(result.clientName).toBe("Dennis W Coleman");
  });

  it("parses the pharmacy block with no preferred pharmacies", () => {
    expect(result.zip).toBe("53051");
    expect(result.takesPrescriptions).toBe(true);
    expect(result.deliveryPreferred).toBe(true);
    expect(result.preferredPharmacies).toEqual([]);
  });

  it("parses all ten structured medications", () => {
    const structured = result.medications.filter((m) => m.source === "structured");
    expect(structured).toHaveLength(10);
    expect(structured[0]).toMatchObject({
      name: "albuterol sulfate",
      dosageText: "albuterol sulfate AER HFA (similar to ProAir HFA) - 8.5GM Inhaler",
      quantity: 1,
      daysSupply: 30,
      genericOk: true,
    });
    expect(structured.map((m) => m.name)).toContain("nintedanib esylate");
  });

  it("keeps the free-text note but drops the glued timestamp and submitter name", () => {
    const freetext = result.medications.filter((m) => m.source === "freetext");
    expect(freetext).toHaveLength(1);
    expect(freetext[0]).toMatchObject({
      name: "Albuterol inhaler 90mg 3x/day as needed",
      prn: true,
    });
  });

  it("parses the in-force policy", () => {
    expect(result.inForcePolicies).toEqual([
      expect.objectContaining({
        carrierName: "Humana",
        policyNumber: "H06998253",
        policyType: "ma_pd",
      }),
    ]);
  });
});

describe("parseRxcText — Lynch sample (2025+ revision, incomplete, wrapped cells)", () => {
  const result = parseRxcText(fixturePages("lynch-2025"));

  it("parses the header despite the INCOMPLETE banner and Options token", () => {
    expect(result.clientName).toBe("Janice R Lynch");
    expect(result.zip).toBe("83646");
    expect(result.takesPrescriptions).toBe(true);
    expect(result.deliveryPreferred).toBe(false);
  });

  it("folds the wrapped ZIP back into the pharmacy entry", () => {
    expect(result.preferredPharmacies).toEqual([
      "Albertsons Pharmacy #3195 - 3499 E Fairview Ave Meridian ID 83642",
    ]);
  });

  it("parses all six structured medications with wrapped dosage cells", () => {
    const structured = result.medications.filter((m) => m.source === "structured");
    expect(structured.map((m) => m.name)).toEqual([
      "estradiol vaginal",
      "lisinopril",
      "Lyrica",
      "metformin hcl",
      "sertraline hcl",
      "valacyclovir hcl",
    ]);
    expect(structured.find((m) => m.name === "valacyclovir hcl")).toMatchObject({
      quantity: 50,
      daysSupply: 360,
    });
  });

  it("rejoins the wrapped policy line and classifies it", () => {
    expect(result.inForcePolicies).toEqual([
      expect.objectContaining({
        carrierName: "PacificSource (Medicare)",
        policyNumber: "610257071",
        policyType: "ma_pd",
      }),
    ]);
  });
});

describe("splitNameAndDosage", () => {
  it("splits on the longest doubled token prefix", () => {
    expect(
      splitNameAndDosage("metoprolol succinate er metoprolol succinate er TAB 50MG ER"),
    ).toEqual({
      name: "metoprolol succinate er",
      dosageText: "metoprolol succinate er TAB 50MG ER",
    });
  });

  it("falls back to first-token name for brand rows with generic dosage", () => {
    expect(splitNameAndDosage("Cortef hydrocortisone (Tablets) TAB 10MG")).toEqual({
      name: "Cortef",
      dosageText: "hydrocortisone (Tablets) TAB 10MG",
    });
  });

  it("keeps a bare name intact when no dosage marker exists", () => {
    expect(splitNameAndDosage("Eliquis")).toEqual({ name: "Eliquis", dosageText: null });
  });
});

describe("classifyPolicyType", () => {
  it("classifies the full vocabulary", () => {
    expect(classifyPolicyType("PDP")).toBe("pdp");
    expect(classifyPolicyType("MAPD")).toBe("ma_pd");
    expect(classifyPolicyType("MA-PD")).toBe("ma_pd");
    expect(classifyPolicyType("Medicare Advantage")).toBe("ma_pd");
    expect(classifyPolicyType("Med Supp")).toBe("med_supp");
    expect(classifyPolicyType("Medicare Supplement")).toBe("med_supp");
    expect(classifyPolicyType("Dental")).toBe("other");
  });
});
