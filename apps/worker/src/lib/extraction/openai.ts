/**
 * OpenAI provider: Responses API. PDFs go in as base64 `input_file` content
 * (data: URL form), structured output via `text.format` json_schema with
 * strict mode, reusing the shared JSON Schemas. Output is still zod-gated —
 * strict mode is an extra belt, not the gate.
 */
import OpenAI from "openai";
import type { ExtractionSpec } from "./schemas";
import {
  forcePageNumber,
  formularyLegendSpec,
  formularyPageSpec,
  formularyPageUserText,
  formularyPlanNamesSpec,
  pharmacyDirectorySpec,
  rxcExtractionSpec,
  sobExtractionSpec,
} from "./schemas";
import type { ExtractionProvider } from "./types";

export const OPENAI_DEFAULT_MODEL = "gpt-5-mini";
/**
 * OpenAI PDF file inputs are page-capped (~100 pages per request), regardless
 * of the model's token context — chunk formulary PDFs well under that.
 */
export const OPENAI_MAX_CONTEXT_PAGES = 50;

const MAX_OUTPUT_TOKENS = 16000;

/** Minimal surface the provider needs; the real OpenAI client satisfies it. */
export interface OpenAIResponsesClient {
  responses: {
    create(
      params: OpenAI.Responses.ResponseCreateParamsNonStreaming,
    ): Promise<OpenAI.Responses.Response>;
  };
}

export interface OpenAIProviderDeps {
  client?: OpenAIResponsesClient;
  apiKey?: string;
  model?: string;
  /**
   * Explicit null disables escalation. There is no hardcoded default — set
   * EXTRACTION_ESCALATION_MODEL to OpenAI's current top-tier model id.
   */
  escalationModel?: string | null;
}

type InputContent =
  | OpenAI.Responses.ResponseInputText
  | OpenAI.Responses.ResponseInputFile;

const pdfContent = (base64: string): OpenAI.Responses.ResponseInputFile => ({
  type: "input_file",
  filename: "document.pdf",
  file_data: `data:application/pdf;base64,${base64}`,
});

export function createOpenAIProvider(deps: OpenAIProviderDeps = {}): ExtractionProvider {
  const model = deps.model ?? OPENAI_DEFAULT_MODEL;
  const escalationModel = deps.escalationModel ?? null;
  const client: OpenAIResponsesClient =
    deps.client ?? new OpenAI({ apiKey: deps.apiKey });

  async function run<T>(
    spec: ExtractionSpec<T>,
    content: InputContent[],
    callModel: string,
  ): Promise<T> {
    const response = await client.responses.create({
      model: callModel,
      instructions: spec.systemPrompt,
      input: [{ role: "user", content }],
      max_output_tokens: MAX_OUTPUT_TOKENS,
      text: {
        format: {
          type: "json_schema",
          name: spec.toolName,
          description: spec.description,
          schema: spec.jsonSchema,
          strict: true,
        },
      },
    });

    const text = response.output_text;
    if (!text) {
      throw new Error(
        `OpenAI returned no output text for ${spec.toolName} (status: ${response.status})`,
      );
    }
    return spec.parse(JSON.parse(text));
  }

  return {
    providerName: "openai",
    model,
    escalationModel,
    maxContextPages: OPENAI_MAX_CONTEXT_PAGES,

    async extractRxc(pdfBase64, options) {
      return run(
        rxcExtractionSpec,
        [pdfContent(pdfBase64), { type: "input_text", text: "Extract this RxC export." }],
        options?.model ?? model,
      );
    },

    async extractFormularyPage(pdfBase64OrChunk, pageNumber, options) {
      const page = await run(
        formularyPageSpec,
        [
          pdfContent(pdfBase64OrChunk),
          { type: "input_text", text: formularyPageUserText(pageNumber) },
        ],
        options?.model ?? model,
      );
      return forcePageNumber(page, pageNumber);
    },

    async extractFormularyLegend(pdfBase64, options) {
      return run(
        formularyLegendSpec,
        [
          pdfContent(pdfBase64),
          { type: "input_text", text: "Extract the abbreviation legend." },
        ],
        options?.model ?? model,
      );
    },

    async extractFormularyPlanNames(pdfBase64, options) {
      return run(
        formularyPlanNamesSpec,
        [
          pdfContent(pdfBase64),
          { type: "input_text", text: "List the plan names this formulary applies to." },
        ],
        options?.model ?? model,
      );
    },

    async extractSummaryOfBenefits(pdfBase64, options) {
      return run(
        sobExtractionSpec,
        [
          pdfContent(pdfBase64),
          { type: "input_text", text: "Extract the drug cost sharing from this Summary of Benefits." },
        ],
        options?.model ?? model,
      );
    },

    async extractPharmacyDirectoryRows(directoryText, options) {
      return run(
        pharmacyDirectorySpec,
        [{ type: "input_text", text: directoryText }],
        options?.model ?? model,
      );
    },
  };
}
