/**
 * Provider-neutral extraction specs. One spec per extraction kind bundles the
 * system prompt, a hand-written JSON Schema (kept in sync with the zod
 * contracts in @rxsr/core/intake — intentionally no runtime zod→JSON-Schema
 * converter), and the zod parse that gates EVERY provider's output before it
 * can reach the DB. The JSON Schemas are the widely-supported strict subset:
 * additionalProperties:false everywhere, all properties required, nullability
 * via type unions — accepted by Anthropic tool inputs, OpenAI json_schema
 * strict mode, and Gemini responseJsonSchema alike.
 */
import { z } from "zod";
import {
  formularyPageSchema,
  rxcExtractionSchema,
  type FormularyPage,
  type RxcExtraction,
} from "@rxsr/core/intake";

/** Object-rooted JSON Schema (structurally satisfies Anthropic's InputSchema). */
export interface JsonObjectSchema {
  type: "object";
  [key: string]: unknown;
}

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

// ─── Hand-written JSON Schemas ───────────────────────────────────────────────

const RXC_JSON_SCHEMA: JsonObjectSchema = {
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

const FORMULARY_PAGE_JSON_SCHEMA: JsonObjectSchema = {
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

const LEGEND_JSON_SCHEMA: JsonObjectSchema = {
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

const DIRECTORY_JSON_SCHEMA: JsonObjectSchema = {
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

// ─── Specs ───────────────────────────────────────────────────────────────────

export interface ExtractionSpec<T> {
  /** Tool name (Anthropic) / schema name (OpenAI); stable identifier. */
  toolName: string;
  description: string;
  systemPrompt: string;
  jsonSchema: JsonObjectSchema;
  parse(input: unknown): T;
}

export const rxcExtractionSpec: ExtractionSpec<RxcExtraction> = {
  toolName: "record_rxc_extraction",
  description: "Record the structured extraction of an RxC export PDF.",
  systemPrompt: `You extract structured data from AgencyBloc Rx Collect (RxC) PDF exports for a Medicare drug-coverage analysis tool. Extract:
- The client name from the header.
- The Preferred Pharmacies block: "Do you take prescriptions?", the ZIP code, up to 3 preferred pharmacy strings (verbatim, in order), and delivery preference.
- Every row of the Current Prescriptions table as a medication with source "structured". Copy the Medication column into "name" and the Dosage column into "dosageText" verbatim.
- Any prescriptions mentioned only in the Additional Information free text as medications with source "freetext" (these are riskier: keep confidence at or below 0.8).
- Every line under IN FORCE POLICIES verbatim, classifying each: "PDP" → pdp, "MAPD"/"MA-PD"/Medicare Advantage with drug coverage → ma_pd, "Med Supp"/Medigap → med_supp, anything else → other.
Set fields to null when the form leaves them blank. Never invent rows.`,
  jsonSchema: RXC_JSON_SCHEMA,
  parse: (input) => rxcExtractionSchema.parse(input),
};

/**
 * Shared per-page prefix: byte-identical across every page call for one
 * document/chunk so provider-side prompt caching can reuse it.
 */
export const formularyPageSpec: ExtractionSpec<FormularyPage> = {
  toolName: "record_formulary_page",
  description: "Record the drug rows extracted from one formulary page.",
  systemPrompt: `You extract drug rows from CMS Part D formulary PDFs (three-column layout: DRUG NAME, DRUG TIER, REQUIREMENTS/LIMITS), grouped under therapeutic category headings.
Rules:
- Extract ONLY rows from the requested page. If the page is a cover page, front matter, legend, or alphabetical index, return an empty rows array.
- Copy the drug name verbatim including casing (lowercase = generic, UPPERCASE = brand) and any multi-strength list ("15 mg, 30 mg, 60 mg") exactly as printed.
- Copy the requirements column verbatim ("PA; QL (240 per 30 days); NEDS"); use null for empty or dash cells.
- therapeuticCategory is the nearest category heading above the row (headings can carry over from a previous page); null if unknown.
- A row split across columns or pages belongs to the page where its drug name starts.`,
  jsonSchema: FORMULARY_PAGE_JSON_SCHEMA,
  parse: (input) => formularyPageSchema.parse(input),
};

export const formularyLegendSpec: ExtractionSpec<FormularyLegendExtraction> = {
  toolName: "record_formulary_legend",
  description: "Record the formulary's abbreviation legend entries.",
  systemPrompt: `You extract the abbreviation legend / key from a CMS Part D formulary PDF: the page(s) in the front matter that define restriction codes (e.g. PA = Prior Authorization, QL = Quantity Limit, NM = Not available at mail order, NEDS, B/D PA). Extract every code exactly as printed with the carrier's own definition text. Do not include drug rows.`,
  jsonSchema: LEGEND_JSON_SCHEMA,
  parse: (input) => formularyLegendExtractionSchema.parse(input),
};

export const pharmacyDirectorySpec: ExtractionSpec<PharmacyDirectoryExtraction> = {
  toolName: "record_pharmacy_directory",
  description: "Record pharmacy rows extracted from directory text.",
  systemPrompt: `You extract pharmacy rows from a Medicare plan pharmacy directory. For each pharmacy listed in the provided text, record its name, street address (single line, null if absent), 5-digit ZIP (null if absent), and network status: "preferred" when the directory marks it preferred/preferred cost-sharing, otherwise "standard". Never invent rows.`,
  jsonSchema: DIRECTORY_JSON_SCHEMA,
  parse: (input) => pharmacyDirectoryExtractionSchema.parse(input),
};

// ─── Shared per-call helpers ─────────────────────────────────────────────────

export const formularyPageUserText = (pageNumber: number): string =>
  `Extract the drug rows of page ${pageNumber} (1-indexed by the PDF page order of the provided document, not the printed page number). Set "page" to ${pageNumber}.`;

/**
 * Models occasionally echo the printed page number; provenance must point at
 * the page that was requested.
 */
export const forcePageNumber = (page: FormularyPage, requested: number): FormularyPage =>
  page.page === requested ? page : { ...page, page: requested };
