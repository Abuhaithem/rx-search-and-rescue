/**
 * Claude client wrapper — the only place AI extraction happens.
 * Structured output is enforced via forced tool-use: each extractor declares a
 * single tool whose input_schema is a hand-written JSON Schema mirror of the
 * zod contract, and the tool_use input is validated with that zod schema
 * before anything reaches the DB. The JSON schemas below must stay in sync
 * with @rxsr/core/intake — they are intentionally hand-written (no runtime
 * zod→JSON-Schema converter dependency).
 */
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import {
  formularyPageSchema,
  rxcExtractionSchema,
  type FormularyPage,
  type RxcExtraction,
} from "@rxsr/core/intake";

export const EXTRACTION_MODEL = "claude-opus-4-8";
const MAX_TOKENS = 16000;

// ─── Worker-local extraction contracts (not part of @rxsr/core) ──────────────

export const formularyLegendExtractionSchema = z.object({
  entries: z.array(
    z.object({
      /** Abbreviation code exactly as printed, e.g. "NM", "B/D PA". */
      code: z.string().min(1),
      definition: z.string().min(1),
    }),
  ),
});
export type FormularyLegendExtraction = z.infer<typeof formularyLegendExtractionSchema>;

export const pharmacyDirectoryExtractionSchema = z.object({
  rows: z.array(
    z.object({
      pharmacyName: z.string().min(1),
      address: z.string().nullable(),
      zip: z.string().nullable(),
      status: z.enum(["preferred", "standard"]),
    }),
  ),
});
export type PharmacyDirectoryExtraction = z.infer<typeof pharmacyDirectoryExtractionSchema>;

// ─── Hand-written JSON Schemas (keep in sync with the zod contracts) ─────────

const RXC_INPUT_SCHEMA: Anthropic.Messages.Tool.InputSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "clientName",
    "zip",
    "takesPrescriptions",
    "preferredPharmacies",
    "deliveryPreferred",
    "medications",
    "inForcePolicies",
  ],
  properties: {
    clientName: { type: "string", minLength: 1 },
    zip: { type: ["string", "null"], pattern: "^\\d{5}$" },
    takesPrescriptions: { type: ["boolean", "null"] },
    preferredPharmacies: {
      type: "array",
      maxItems: 3,
      items: { type: "string", minLength: 1 },
      description: "Raw preferred-pharmacy strings, verbatim, in form order.",
    },
    deliveryPreferred: { type: ["boolean", "null"] },
    medications: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "name",
          "dosageText",
          "quantity",
          "daysSupply",
          "genericOk",
          "prn",
          "source",
          "confidence",
          "rawText",
        ],
        properties: {
          name: {
            type: "string",
            minLength: 1,
            description: 'Short name column, e.g. "Eliquis", "losartan potassium".',
          },
          dosageText: {
            type: ["string", "null"],
            description: 'Full dosage description, e.g. "Eliquis TAB 2.5MG".',
          },
          quantity: { type: ["integer", "null"], minimum: 1 },
          daysSupply: {
            type: ["integer", "null"],
            minimum: 1,
            description: "Refill frequency in days (30/60/90…).",
          },
          genericOk: { type: ["boolean", "null"] },
          prn: {
            type: "boolean",
            description: 'True when annotated "(prn)" / "as needed".',
          },
          source: {
            type: "string",
            enum: ["structured", "freetext"],
            description:
              '"structured" = prescriptions table row; "freetext" = Additional Information.',
          },
          confidence: {
            type: "number",
            minimum: 0,
            maximum: 1,
            description: "Extractor confidence 0-1; freetext rows rarely exceed 0.8.",
          },
          rawText: { type: "string", minLength: 1 },
        },
      },
    },
    inForcePolicies: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["rawText", "carrierName", "policyNumber", "policyType"],
        properties: {
          rawText: { type: "string", minLength: 1 },
          carrierName: { type: ["string", "null"] },
          policyNumber: { type: ["string", "null"] },
          policyType: { type: "string", enum: ["pdp", "ma_pd", "med_supp", "other"] },
        },
      },
    },
  },
};

const FORMULARY_PAGE_INPUT_SCHEMA: Anthropic.Messages.Tool.InputSchema = {
  type: "object",
  additionalProperties: false,
  required: ["page", "rows"],
  properties: {
    page: { type: "integer", minimum: 1 },
    rows: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["rawDrugName", "tier", "requirementsText", "therapeuticCategory"],
        properties: {
          rawDrugName: {
            type: "string",
            minLength: 1,
            description:
              "Drug name column verbatim, casing preserved (UPPERCASE = brand).",
          },
          tier: { type: "integer", minimum: 1, maximum: 6 },
          requirementsText: {
            type: ["string", "null"],
            description:
              'Requirements/Limits column verbatim, e.g. "PA; QL (60 per 30 days); NM". Null when empty or "—".',
          },
          therapeuticCategory: {
            type: ["string", "null"],
            description: "Group heading the row appears under, e.g. ANTINEOPLASTICS.",
          },
        },
      },
    },
  },
};

const LEGEND_INPUT_SCHEMA: Anthropic.Messages.Tool.InputSchema = {
  type: "object",
  additionalProperties: false,
  required: ["entries"],
  properties: {
    entries: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["code", "definition"],
        properties: {
          code: { type: "string", minLength: 1 },
          definition: { type: "string", minLength: 1 },
        },
      },
    },
  },
};

const DIRECTORY_INPUT_SCHEMA: Anthropic.Messages.Tool.InputSchema = {
  type: "object",
  additionalProperties: false,
  required: ["rows"],
  properties: {
    rows: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["pharmacyName", "address", "zip", "status"],
        properties: {
          pharmacyName: { type: "string", minLength: 1 },
          address: { type: ["string", "null"] },
          zip: { type: ["string", "null"], pattern: "^\\d{5}" },
          status: { type: "string", enum: ["preferred", "standard"] },
        },
      },
    },
  },
};

// ─── Prompts ─────────────────────────────────────────────────────────────────

const RXC_SYSTEM_PROMPT = `You extract structured data from AgencyBloc Rx Collect (RxC) PDF exports for a Medicare drug-coverage analysis tool. Extract:
- The client name from the header.
- The Preferred Pharmacies block: "Do you take prescriptions?", the ZIP code, up to 3 preferred pharmacy strings (verbatim, in order), and delivery preference.
- Every row of the Current Prescriptions table as a medication with source "structured". Copy the Medication column into "name" and the Dosage column into "dosageText" verbatim.
- Any prescriptions mentioned only in the Additional Information free text as medications with source "freetext" (these are riskier: keep confidence at or below 0.8).
- Every line under IN FORCE POLICIES verbatim, classifying each: "PDP" → pdp, "MAPD"/"MA-PD"/Medicare Advantage with drug coverage → ma_pd, "Med Supp"/Medigap → med_supp, anything else → other.
Set fields to null when the form leaves them blank. Never invent rows. Record the extraction with the record_rxc_extraction tool.`;

/**
 * Shared per-page prefix: byte-identical across every page call for one
 * document so the prompt cache can reuse tools + system (+ the document,
 * which carries its own cache breakpoint).
 */
const FORMULARY_PAGE_SYSTEM_PROMPT = `You extract drug rows from CMS Part D formulary PDFs (three-column layout: DRUG NAME, DRUG TIER, REQUIREMENTS/LIMITS), grouped under therapeutic category headings.
Rules:
- Extract ONLY rows from the requested page. If the page is a cover page, front matter, legend, or alphabetical index, return an empty rows array.
- Copy the drug name verbatim including casing (lowercase = generic, UPPERCASE = brand) and any multi-strength list ("15 mg, 30 mg, 60 mg") exactly as printed.
- Copy the requirements column verbatim ("PA; QL (240 per 30 days); NEDS"); use null for empty or dash cells.
- therapeuticCategory is the nearest category heading above the row (headings can carry over from a previous page); null if unknown.
- A row split across columns or pages belongs to the page where its drug name starts.
Record the page with the record_formulary_page tool.`;

const LEGEND_SYSTEM_PROMPT = `You extract the abbreviation legend / key from a CMS Part D formulary PDF: the page(s) in the front matter that define restriction codes (e.g. PA = Prior Authorization, QL = Quantity Limit, NM = Not available at mail order, NEDS, B/D PA). Extract every code exactly as printed with the carrier's own definition text. Do not include drug rows. Record with the record_formulary_legend tool.`;

const DIRECTORY_SYSTEM_PROMPT = `You extract pharmacy rows from a Medicare plan pharmacy directory. For each pharmacy listed in the provided text, record its name, street address (single line, null if absent), 5-digit ZIP (null if absent), and network status: "preferred" when the directory marks it preferred/preferred cost-sharing, otherwise "standard". Never invent rows. Record with the record_pharmacy_directory tool.`;

// ─── Client plumbing ─────────────────────────────────────────────────────────

/** Minimal surface the extractor needs; the real Anthropic client satisfies it. */
export interface ClaudeMessagesClient {
  messages: {
    create(
      params: Anthropic.Messages.MessageCreateParamsNonStreaming,
    ): Promise<Anthropic.Messages.Message>;
  };
}

export interface Extractor {
  extractRxc(pdfBase64: string): Promise<RxcExtraction>;
  extractFormularyPage(
    pageImageOrPdfBase64: string,
    pageNumber: number,
  ): Promise<FormularyPage>;
  extractFormularyLegend(pdfBase64: string): Promise<FormularyLegendExtraction>;
  extractPharmacyDirectoryRows(directoryText: string): Promise<PharmacyDirectoryExtraction>;
}

export interface ExtractorDeps {
  client?: ClaudeMessagesClient;
  model?: string;
}

const pdfBlock = (
  base64: string,
  cache: boolean,
): Anthropic.Messages.DocumentBlockParam => ({
  type: "document",
  source: { type: "base64", media_type: "application/pdf", data: base64 },
  ...(cache ? { cache_control: { type: "ephemeral" } } : {}),
});

async function extractViaTool<T>(
  client: ClaudeMessagesClient,
  model: string,
  options: {
    system: Anthropic.Messages.TextBlockParam[];
    content: Anthropic.Messages.ContentBlockParam[];
    toolName: string;
    toolDescription: string;
    inputSchema: Anthropic.Messages.Tool.InputSchema;
    schema: { parse(input: unknown): T };
  },
): Promise<T> {
  const response = await client.messages.create({
    model,
    max_tokens: MAX_TOKENS,
    system: options.system,
    tools: [
      {
        name: options.toolName,
        description: options.toolDescription,
        input_schema: options.inputSchema,
      },
    ],
    tool_choice: { type: "tool", name: options.toolName },
    messages: [{ role: "user", content: options.content }],
  });

  const toolUse = response.content.find(
    (block): block is Anthropic.Messages.ToolUseBlock =>
      block.type === "tool_use" && block.name === options.toolName,
  );
  if (!toolUse) {
    throw new Error(
      `Claude returned no ${options.toolName} tool call (stop_reason: ${response.stop_reason})`,
    );
  }
  return options.schema.parse(toolUse.input);
}

export function createExtractor(deps: ExtractorDeps = {}): Extractor {
  const model = deps.model ?? EXTRACTION_MODEL;
  const client: ClaudeMessagesClient = deps.client ?? new Anthropic();

  return {
    async extractRxc(pdfBase64) {
      return extractViaTool(client, model, {
        system: [{ type: "text", text: RXC_SYSTEM_PROMPT }],
        content: [
          pdfBlock(pdfBase64, false),
          { type: "text", text: "Extract this RxC export." },
        ],
        toolName: "record_rxc_extraction",
        toolDescription: "Record the structured extraction of an RxC export PDF.",
        inputSchema: RXC_INPUT_SCHEMA,
        schema: rxcExtractionSchema,
      });
    },

    async extractFormularyPage(pageImageOrPdfBase64, pageNumber) {
      const page = await extractViaTool(client, model, {
        system: [
          {
            type: "text",
            text: FORMULARY_PAGE_SYSTEM_PROMPT,
            // Shared prefix across every page of a document: cache it.
            cache_control: { type: "ephemeral" },
          },
        ],
        content: [
          pdfBlock(pageImageOrPdfBase64, true),
          {
            type: "text",
            text: `Extract the drug rows of page ${pageNumber} (1-indexed by the PDF page order, not the printed page number). Set "page" to ${pageNumber}.`,
          },
        ],
        toolName: "record_formulary_page",
        toolDescription: "Record the drug rows extracted from one formulary page.",
        inputSchema: FORMULARY_PAGE_INPUT_SCHEMA,
        schema: formularyPageSchema,
      });
      // The model occasionally echoes the printed page number; provenance must
      // point at the PDF page we asked for.
      return page.page === pageNumber ? page : { ...page, page: pageNumber };
    },

    async extractFormularyLegend(pdfBase64) {
      return extractViaTool(client, model, {
        system: [{ type: "text", text: LEGEND_SYSTEM_PROMPT }],
        content: [
          pdfBlock(pdfBase64, false),
          { type: "text", text: "Extract the abbreviation legend." },
        ],
        toolName: "record_formulary_legend",
        toolDescription: "Record the formulary's abbreviation legend entries.",
        inputSchema: LEGEND_INPUT_SCHEMA,
        schema: formularyLegendExtractionSchema,
      });
    },

    async extractPharmacyDirectoryRows(directoryText) {
      return extractViaTool(client, model, {
        system: [{ type: "text", text: DIRECTORY_SYSTEM_PROMPT }],
        content: [{ type: "text", text: directoryText }],
        toolName: "record_pharmacy_directory",
        toolDescription: "Record pharmacy rows extracted from directory text.",
        inputSchema: DIRECTORY_INPUT_SCHEMA,
        schema: pharmacyDirectoryExtractionSchema,
      });
    },
  };
}
