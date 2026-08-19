/**
 * Gemini provider (@google/genai): PDFs via inlineData parts, structured
 * output via responseMimeType application/json + responseJsonSchema (the
 * SDK's raw-JSON-Schema variant of responseSchema, so the shared schemas are
 * reused verbatim). Output is still zod-gated. 1M context — whole documents,
 * no chunking (maxContextPages undefined).
 */
import {
  GoogleGenAI,
  type GenerateContentParameters,
  type GenerateContentResponse,
} from "@google/genai";
import type { ExtractionSpec } from "./schemas";
import {
  forcePageNumber,
  formularyLegendSpec,
  formularyPageSpec,
  formularyPageUserText,
  quantityLimitPageSpec,
  quantityLimitPageUserText,
  formularyPlanNamesSpec,
  pharmacyDirectorySpec,
  pharmacyRosterSpec,
  brandGroupingSpec,
  drugResolutionSpec,
  pharmacyResolutionSpec,
  rxcExtractionSpec,
  sobExtractionSpec,
} from "./schemas";
import type { ExtractionProvider } from "./types";

export const GEMINI_DEFAULT_MODEL = "gemini-2.5-flash-lite";
export const GEMINI_DEFAULT_ESCALATION_MODEL = "gemini-3-flash";

const MAX_OUTPUT_TOKENS = 16000;

/** Minimal surface the provider needs; the real GoogleGenAI client satisfies it. */
export interface GeminiModelsClient {
  models: {
    generateContent(
      params: GenerateContentParameters,
    ): Promise<GenerateContentResponse>;
  };
}

export interface GeminiProviderDeps {
  client?: GeminiModelsClient;
  apiKey?: string;
  model?: string;
  /** Explicit null disables escalation; undefined uses the default. */
  escalationModel?: string | null;
}

interface Part {
  text?: string;
  inlineData?: { mimeType: string; data: string };
}

const pdfPart = (base64: string): Part => ({
  inlineData: { mimeType: "application/pdf", data: base64 },
});

export function createGeminiProvider(deps: GeminiProviderDeps = {}): ExtractionProvider {
  const model = deps.model ?? GEMINI_DEFAULT_MODEL;
  const escalationModel =
    deps.escalationModel === undefined
      ? GEMINI_DEFAULT_ESCALATION_MODEL
      : deps.escalationModel;
  const client: GeminiModelsClient =
    deps.client ?? new GoogleGenAI({ apiKey: deps.apiKey });

  async function run<T>(
    spec: ExtractionSpec<T>,
    parts: Part[],
    callModel: string,
  ): Promise<T> {
    const response = await client.models.generateContent({
      model: callModel,
      contents: [{ role: "user", parts }],
      config: {
        systemInstruction: spec.systemPrompt,
        responseMimeType: "application/json",
        responseJsonSchema: spec.jsonSchema,
        maxOutputTokens: MAX_OUTPUT_TOKENS,
      },
    });

    const text = response.text;
    if (!text) {
      throw new Error(`Gemini returned no output text for ${spec.toolName}`);
    }
    return spec.parse(JSON.parse(text));
  }

  return {
    providerName: "gemini",
    model,
    escalationModel,
    // maxContextPages intentionally undefined: 1M context, whole documents.

    async extractRxc(pdfBase64, options) {
      return run(
        rxcExtractionSpec,
        [pdfPart(pdfBase64), { text: "Extract this RxC export." }],
        options?.model ?? model,
      );
    },

    async extractFormularyPage(pdfBase64OrChunk, pageNumber, options) {
      const page = await run(
        formularyPageSpec,
        [pdfPart(pdfBase64OrChunk), { text: formularyPageUserText(pageNumber) }],
        options?.model ?? model,
      );
      return forcePageNumber(page, pageNumber);
    },

    async extractQuantityLimitPage(pdfBase64OrChunk, pageNumber, options) {
      const page = await run(
        quantityLimitPageSpec,
        [pdfPart(pdfBase64OrChunk), { text: quantityLimitPageUserText(pageNumber) }],
        options?.model ?? model,
      );
      return forcePageNumber(page, pageNumber);
    },

    async extractFormularyLegend(pdfBase64, options) {
      return run(
        formularyLegendSpec,
        [pdfPart(pdfBase64), { text: "Extract the abbreviation legend." }],
        options?.model ?? model,
      );
    },

    async extractFormularyPlanNames(pdfBase64, options) {
      return run(
        formularyPlanNamesSpec,
        [pdfPart(pdfBase64), { text: "List the plan names this formulary applies to." }],
        options?.model ?? model,
      );
    },

    async extractSummaryOfBenefits(pdfBase64, options) {
      return run(
        sobExtractionSpec,
        [pdfPart(pdfBase64), { text: "Extract the drug cost sharing from this Summary of Benefits." }],
        options?.model ?? model,
      );
    },

    async extractPharmacyDirectoryRows(directoryText, options) {
      return run(
        pharmacyDirectorySpec,
        [{ text: directoryText }],
        options?.model ?? model,
      );
    },

    async resolvePharmacyCandidate(promptText, options) {
      return run(
        pharmacyResolutionSpec,
        [{ text: promptText }],
        options?.model ?? model,
      );
    },

    async resolveDrugNames(promptText, options) {
      return run(
        drugResolutionSpec,
        [{ text: promptText }],
        options?.model ?? model,
      );
    },

    async groupPharmacyBrands(promptText, options) {
      return run(
        brandGroupingSpec,
        [{ text: promptText }],
        options?.model ?? model,
      );
    },

    async extractPharmacyRosterRows(rosterText, options) {
      return run(
        pharmacyRosterSpec,
        [{ text: rosterText }],
        options?.model ?? model,
      );
    },
  };
}
