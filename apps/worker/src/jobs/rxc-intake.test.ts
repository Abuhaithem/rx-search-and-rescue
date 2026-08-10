import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { ExtractedPolicy, RxcExtraction } from "@rxsr/core/intake";
import type { ExtractionProvider } from "../lib/extraction";
import type { PdfTextReader } from "../lib/pdf";
import {
  LLM_FALLBACK_MAX_CONFIDENCE,
  pickCurrentDrugPlanIndex,
  resolveRxcExtraction,
} from "./rxc-intake";

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

const healyPages = readFileSync(
  new URL("../../test/fixtures/rxc/healy.txt", import.meta.url),
  "utf8",
).split("\f");

const llmExtraction: RxcExtraction = {
  clientName: "LLM Client",
  zip: null,
  takesPrescriptions: null,
  preferredPharmacies: [],
  deliveryPreferred: null,
  medications: [
    {
      name: "Eliquis",
      dosageText: null,
      quantity: null,
      daysSupply: null,
      genericOk: null,
      prn: false,
      source: "structured",
      confidence: 0.98,
      rawText: "Eliquis",
    },
    {
      name: "hydrocort",
      dosageText: null,
      quantity: null,
      daysSupply: null,
      genericOk: null,
      prn: false,
      source: "freetext",
      confidence: 0.4,
      rawText: "hydrocort 10 mg",
    },
  ],
  inForcePolicies: [],
};

function fakeProvider(): { provider: ExtractionProvider; calls: string[] } {
  const calls: string[] = [];
  const provider = {
    providerName: "anthropic",
    model: "fake-model",
    escalationModel: null,
    async extractRxc() {
      calls.push("extractRxc");
      return llmExtraction;
    },
    async extractFormularyPage() {
      throw new Error("not used");
    },
    async extractFormularyLegend() {
      throw new Error("not used");
    },
    async extractFormularyPlanNames() {
      throw new Error("not used");
    },
    async extractSummaryOfBenefits() {
      throw new Error("not used");
    },
    async extractPharmacyDirectoryRows() {
      throw new Error("not used");
    },
  } satisfies ExtractionProvider;
  return { provider, calls };
}

const pdfReturning = (pages: string[]): PdfTextReader => ({
  async extractPageTexts() {
    return { totalPages: pages.length, pages };
  },
});

describe("resolveRxcExtraction", () => {
  it("uses the deterministic parser and never calls the LLM on a clean export", async () => {
    const { provider, calls } = fakeProvider();
    const result = await resolveRxcExtraction(
      { pdf: pdfReturning(healyPages), extractor: provider },
      new Uint8Array([1, 2, 3]),
    );
    expect(result.parseMethod).toBe("deterministic");
    expect(result.extraction.clientName).toBe("Marilyn Healy");
    expect(result.extraction.medications.every((m) => m.confidence === 1)).toBe(true);
    expect(calls).toEqual([]);
  });

  it("falls back to the LLM provider on layout drift and caps confidence", async () => {
    const { provider, calls } = fakeProvider();
    const result = await resolveRxcExtraction(
      { pdf: pdfReturning(["Some Client", "unrecognizable layout"]), extractor: provider },
      new Uint8Array([1, 2, 3]),
    );
    expect(result.parseMethod).toBe("llm_fallback");
    expect(calls).toEqual(["extractRxc"]);
    expect(result.extraction.clientName).toBe("LLM Client");
    expect(
      result.extraction.medications.every(
        (m) => m.confidence <= LLM_FALLBACK_MAX_CONFIDENCE,
      ),
    ).toBe(true);
    // Already-lower confidences are preserved, not raised.
    expect(result.extraction.medications[1]?.confidence).toBe(0.4);
  });

  it("falls back when the text layer itself cannot be read (scanned PDF)", async () => {
    const { provider, calls } = fakeProvider();
    const failingPdf: PdfTextReader = {
      async extractPageTexts() {
        throw new Error("no text layer");
      },
    };
    const result = await resolveRxcExtraction(
      { pdf: failingPdf, extractor: provider },
      new Uint8Array([1, 2, 3]),
    );
    expect(result.parseMethod).toBe("llm_fallback");
    expect(calls).toEqual(["extractRxc"]);
  });
});
