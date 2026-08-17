/**
 * Anthropic provider: structured output via forced tool-use (one tool per
 * extraction kind whose input_schema is the shared JSON Schema), zod-gated.
 * Prompt caching: cache_control on the shared system block only — it is
 * reused across every page call. Formulary pages arrive as single-page
 * sub-PDFs (each sent exactly once), so caching the document block would
 * pay the cache-write surcharge for reads that never happen.
 */
import Anthropic from "@anthropic-ai/sdk";
import type { ExtractionSpec } from "./schemas";
import {
  forcePageNumber,
  formularyLegendSpec,
  formularyPageSpec,
  formularyPageUserText,
  formularyPlanNamesSpec,
  pharmacyDirectorySpec,
  drugResolutionSpec,
  pharmacyResolutionSpec,
  quantityLimitPageSpec,
  quantityLimitPageUserText,
  rxcExtractionSpec,
  sobExtractionSpec,
} from "./schemas";
import type { ExtractionProvider } from "./types";

export const ANTHROPIC_DEFAULT_MODEL = "claude-haiku-4-5";
export const ANTHROPIC_DEFAULT_ESCALATION_MODEL = "claude-sonnet-5";
/** Haiku 4.5 has a 200K context window — chunk large formulary PDFs. */
export const ANTHROPIC_MAX_CONTEXT_PAGES = 25;

const MAX_TOKENS = 16000;

/** Minimal surface the provider needs; the real Anthropic client satisfies it. */
export interface ClaudeMessagesClient {
  messages: {
    create(
      params: Anthropic.Messages.MessageCreateParamsNonStreaming,
    ): Promise<Anthropic.Messages.Message>;
  };
}

export interface AnthropicProviderDeps {
  client?: ClaudeMessagesClient;
  model?: string;
  /** Explicit null disables escalation; undefined uses the default. */
  escalationModel?: string | null;
}

const pdfBlock = (
  base64: string,
  cache: boolean,
): Anthropic.Messages.DocumentBlockParam => ({
  type: "document",
  source: { type: "base64", media_type: "application/pdf", data: base64 },
  ...(cache ? { cache_control: { type: "ephemeral" } } : {}),
});

export function createAnthropicProvider(
  deps: AnthropicProviderDeps = {},
): ExtractionProvider {
  const model = deps.model ?? ANTHROPIC_DEFAULT_MODEL;
  const escalationModel =
    deps.escalationModel === undefined
      ? ANTHROPIC_DEFAULT_ESCALATION_MODEL
      : deps.escalationModel;
  const client: ClaudeMessagesClient = deps.client ?? new Anthropic();

  async function run<T>(
    spec: ExtractionSpec<T>,
    content: Anthropic.Messages.ContentBlockParam[],
    callModel: string,
    cacheSystem: boolean,
  ): Promise<T> {
    const response = await client.messages.create({
      model: callModel,
      max_tokens: MAX_TOKENS,
      system: [
        {
          type: "text",
          text: spec.systemPrompt,
          ...(cacheSystem ? { cache_control: { type: "ephemeral" } } : {}),
        },
      ],
      tools: [
        {
          name: spec.toolName,
          description: spec.description,
          input_schema: spec.jsonSchema,
        },
      ],
      tool_choice: { type: "tool", name: spec.toolName },
      messages: [{ role: "user", content }],
    });

    const toolUse = response.content.find(
      (block): block is Anthropic.Messages.ToolUseBlock =>
        block.type === "tool_use" && block.name === spec.toolName,
    );
    if (!toolUse) {
      throw new Error(
        `Claude returned no ${spec.toolName} tool call (stop_reason: ${response.stop_reason})`,
      );
    }
    return spec.parse(toolUse.input);
  }

  return {
    providerName: "anthropic",
    model,
    escalationModel,
    maxContextPages: ANTHROPIC_MAX_CONTEXT_PAGES,

    async extractRxc(pdfBase64, options) {
      return run(
        rxcExtractionSpec,
        [pdfBlock(pdfBase64, false), { type: "text", text: "Extract this RxC export." }],
        options?.model ?? model,
        false,
      );
    },

    async extractFormularyPage(pdfBase64OrChunk, pageNumber, options) {
      const page = await run(
        formularyPageSpec,
        [
          pdfBlock(pdfBase64OrChunk, false),
          { type: "text", text: formularyPageUserText(pageNumber) },
        ],
        options?.model ?? model,
        true,
      );
      return forcePageNumber(page, pageNumber);
    },

    async extractQuantityLimitPage(pdfBase64OrChunk, pageNumber, options) {
      const page = await run(
        quantityLimitPageSpec,
        [
          pdfBlock(pdfBase64OrChunk, false),
          { type: "text", text: quantityLimitPageUserText(pageNumber) },
        ],
        options?.model ?? model,
        true,
      );
      return forcePageNumber(page, pageNumber);
    },

    async extractFormularyLegend(pdfBase64, options) {
      return run(
        formularyLegendSpec,
        [
          pdfBlock(pdfBase64, false),
          { type: "text", text: "Extract the abbreviation legend." },
        ],
        options?.model ?? model,
        false,
      );
    },

    async extractFormularyPlanNames(pdfBase64, options) {
      return run(
        formularyPlanNamesSpec,
        [pdfBlock(pdfBase64, false), { type: "text", text: "List the plan names this formulary applies to." }],
        options?.model ?? model,
        false,
      );
    },

    async extractSummaryOfBenefits(pdfBase64, options) {
      return run(
        sobExtractionSpec,
        [pdfBlock(pdfBase64, false), { type: "text", text: "Extract the drug cost sharing from this Summary of Benefits." }],
        options?.model ?? model,
        false,
      );
    },

    async extractPharmacyDirectoryRows(directoryText, options) {
      return run(
        pharmacyDirectorySpec,
        [{ type: "text", text: directoryText }],
        options?.model ?? model,
        false,
      );
    },

    async resolvePharmacyCandidate(promptText, options) {
      return run(
        pharmacyResolutionSpec,
        [{ type: "text", text: promptText }],
        options?.model ?? model,
        false,
      );
    },

    async resolveDrugNames(promptText, options) {
      return run(
        drugResolutionSpec,
        [{ type: "text", text: promptText }],
        options?.model ?? model,
        false,
      );
    },
  };
}
