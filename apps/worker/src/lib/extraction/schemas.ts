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
      /**
       * Carrier cost-share vocabulary varies ("preferred cost share",
       * "Level 1", "$ saver", plain "in network"…). "unspecified" means the
       * directory names no tier — the job maps it conservatively.
       */
      status: z.enum(["preferred", "standard", "unspecified"]),
      /** Verbatim cost-share wording from the document, for audit. */
      statusLabel: z.string().nullable(),
    }),
  ),
});
export type PharmacyDirectoryExtraction = z.infer<typeof pharmacyDirectoryExtractionSchema>;

export const quantityLimitPageSchema = z.object({
  page: z.number().int().min(1),
  rows: z.array(
    z.object({
      /** Drug name verbatim, casing preserved (bold/UPPERCASE = brand). */
      rawDrugName: z.string().min(1),
      /** Limit column verbatim, e.g. "Maximum of 2 tablets per day". */
      quantityLimitText: z.string().min(1),
    }),
  ),
});
export type QuantityLimitPageExtraction = z.infer<typeof quantityLimitPageSchema>;

export const pharmacyResolutionSchema = z.object({
  /** Index into the provided candidate list; null = none is the pharmacy. */
  matchedIndex: z.number().int().min(0).nullable(),
  confidence: z.number().min(0).max(1),
});
export type PharmacyResolution = z.infer<typeof pharmacyResolutionSchema>;

export const formularyPlanNamesSchema = z.object({
  /** Exact plan names this formulary document says it applies to. */
  planNames: z.array(z.string().min(1)).max(20),
});
export type FormularyPlanNamesExtraction = z.infer<typeof formularyPlanNamesSchema>;

const sobChannelSchema = z.enum([
  "preferred_retail",
  "standard_retail",
  "preferred_mail",
  "standard_mail",
]);

export const sobExtractionSchema = z.object({
  plans: z.array(
    z.object({
      planName: z.string().min(1),
      /** Monthly plan premium; null when the document doesn't state it. */
      premiumCents: z.number().int().min(0).nullable(),
      rxDeductibleCents: z.number().int().min(0).nullable(),
      /** Tiers the deductible applies to before cost sharing, e.g. [3,4,5]. */
      deductibleTiers: z.array(z.number().int().min(1).max(6)),
      /** Statutory insulin cap per 30-day fill when stated (usually 3500). */
      insulinCapCents: z.number().int().min(0).nullable(),
      tiers: z.array(
        z.object({
          tier: z.number().int().min(1).max(6),
          /** Tier display name with the "Tier N:" prefix stripped. */
          label: z.string().nullable(),
          costs: z.array(
            z.object({
              channel: sobChannelSchema,
              daysSupply: z.number().int().positive(),
              copayCents: z.number().int().min(0).nullable(),
              coinsurancePct: z.number().min(0).max(100).nullable(),
              /** Per-fill coinsurance cap ("25% up to $35" → 3500). */
              maxCents: z.number().int().min(0).nullable(),
              covered: z.boolean(),
            }),
          ),
        }),
      ),
    }),
  ),
});
export type SobExtraction = z.infer<typeof sobExtractionSchema>;

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

const QL_PAGE_JSON_SCHEMA: JsonObjectSchema = {
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
        required: ["rawDrugName", "quantityLimitText"],
        properties: {
          rawDrugName: {
            type: "string",
            minLength: 1,
            description: "Drug name column verbatim, casing preserved.",
          },
          quantityLimitText: {
            type: "string",
            minLength: 1,
            description:
              'Quantity limit column verbatim, e.g. "Maximum of 2 tablets per day".',
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
        required: ["pharmacyName", "address", "zip", "status", "statusLabel"],
        properties: {
          pharmacyName: { type: "string", minLength: 1 },
          address: { type: ["string", "null"] },
          zip: { type: ["string", "null"], pattern: "^\\d{5}" },
          status: { type: "string", enum: ["preferred", "standard", "unspecified"] },
          statusLabel: { type: ["string", "null"] },
        },
      },
    },
  },
};

const PHARMACY_RESOLUTION_JSON_SCHEMA: JsonObjectSchema = {
  type: "object",
  additionalProperties: false,
  required: ["matchedIndex", "confidence"],
  properties: {
    matchedIndex: {
      type: ["integer", "null"],
      minimum: 0,
      description: "Index of the matching candidate; null when none is the same pharmacy.",
    },
    confidence: { type: "number", minimum: 0, maximum: 1 },
  },
};

const PLAN_NAMES_JSON_SCHEMA: JsonObjectSchema = {
  type: "object",
  additionalProperties: false,
  required: ["planNames"],
  properties: {
    planNames: {
      type: "array",
      maxItems: 20,
      items: { type: "string", minLength: 1 },
      description: "Exact plan names this formulary applies to, as printed.",
    },
  },
};

const SOB_JSON_SCHEMA: JsonObjectSchema = {
  type: "object",
  additionalProperties: false,
  required: ["plans"],
  properties: {
    plans: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "planName",
          "premiumCents",
          "rxDeductibleCents",
          "deductibleTiers",
          "insulinCapCents",
          "tiers",
        ],
        properties: {
          planName: { type: "string", minLength: 1 },
          premiumCents: { type: ["integer", "null"], minimum: 0 },
          rxDeductibleCents: { type: ["integer", "null"], minimum: 0 },
          deductibleTiers: {
            type: "array",
            items: { type: "integer", minimum: 1, maximum: 6 },
          },
          insulinCapCents: { type: ["integer", "null"], minimum: 0 },
          tiers: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["tier", "label", "costs"],
              properties: {
                tier: { type: "integer", minimum: 1, maximum: 6 },
                label: { type: ["string", "null"] },
                costs: {
                  type: "array",
                  items: {
                    type: "object",
                    additionalProperties: false,
                    required: [
                      "channel",
                      "daysSupply",
                      "copayCents",
                      "coinsurancePct",
                      "maxCents",
                      "covered",
                    ],
                    properties: {
                      channel: {
                        type: "string",
                        enum: [
                          "preferred_retail",
                          "standard_retail",
                          "preferred_mail",
                          "standard_mail",
                        ],
                      },
                      daysSupply: { type: "integer", minimum: 1 },
                      copayCents: { type: ["integer", "null"], minimum: 0 },
                      coinsurancePct: { type: ["number", "null"], minimum: 0, maximum: 100 },
                      maxCents: { type: ["integer", "null"], minimum: 0 },
                      covered: { type: "boolean" },
                    },
                  },
                },
              },
            },
          },
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

/**
 * QL-appendix chart ("Covered drugs with a quantity limit") — a supplement
 * with NO tier column; its rows must never become formulary entries.
 */
export const quantityLimitPageSpec: ExtractionSpec<QuantityLimitPageExtraction> = {
  toolName: "record_quantity_limit_page",
  description: "Record the quantity-limit rows extracted from one QL-chart page.",
  systemPrompt: `You extract rows from the "Covered drugs with a quantity limit (QL)" chart of a Medicare formulary PDF. Its columns are: drug name, brand/generic indicator, and the quantity limit.
Rules:
- Extract ONLY rows from the requested page. If the page is not part of the quantity-limit chart, return an empty rows array.
- Copy the drug name verbatim including casing, strength, and dosage-form parentheticals, exactly as printed.
- Copy the quantity limit column verbatim, e.g. "Maximum of 2 tablets per day", "Maximum of 1 syringe (2.4 ml) per 56 days".
- A row split across columns or pages belongs to the page where its drug name starts.`,
  jsonSchema: QL_PAGE_JSON_SCHEMA,
  parse: (input) => quantityLimitPageSchema.parse(input),
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
  systemPrompt: `You extract pharmacy rows from a Medicare plan pharmacy directory. For each pharmacy listed in the provided text, record its name, street address (single line, null if absent), and 5-digit ZIP (null if absent).

Classify network status — carriers use DIFFERENT vocabulary for the same two tiers, so normalize by meaning, not exact wording:
- "preferred": the LOWER cost-share tier. Wordings seen across carriers: "preferred", "preferred cost share/sharing", "preferred retail/network pharmacy", "$ saver"/"savings pharmacy", "select network", "Level 1"/"Tier 1 cost sharing" (when the document defines two levels and 1 is cheaper).
- "standard": the regular in-network tier. Wordings: "standard", "standard cost share", "non-preferred", "network cost share", "Level 2"/"Tier 2 cost sharing".
- "unspecified": the pharmacy is listed as in-network but the document names NO cost-share tier (some plans have single-tier networks), or the wording is genuinely ambiguous. Never guess "preferred" without tier language.

Always copy the document's verbatim cost-share wording into statusLabel (null when there is none). Never invent rows.`,
  jsonSchema: DIRECTORY_JSON_SCHEMA,
  parse: (input) => pharmacyDirectoryExtractionSchema.parse(input),
};

/**
 * Fallback pharmacy resolution when the deterministic scorer finds nothing:
 * the model only PICKS among database candidates (by index), so it can link
 * but never invent. Results always land unconfirmed for agent review.
 */
export const pharmacyResolutionSpec: ExtractionSpec<PharmacyResolution> = {
  toolName: "record_pharmacy_resolution",
  description: "Record which candidate pharmacy the free-text entry refers to.",
  systemPrompt: `You match a pharmacy a Medicare client wrote on a form against a numbered list of known pharmacies. Clients write storefront names with typos, abbreviations, store numbers, or partial addresses ("Walgreens on State St", "Sav-Mor Meridian").
Rules:
- Answer with the INDEX of the candidate that is the same pharmacy location, and your confidence (0-1).
- Chain name alone is not enough when several locations of that chain are listed — use street, city, or ZIP to pick the location; if you cannot tell which location, return null.
- Return null with low confidence when no candidate is plausibly the same pharmacy. Never guess.`,
  jsonSchema: PHARMACY_RESOLUTION_JSON_SCHEMA,
  parse: (input) => pharmacyResolutionSchema.parse(input),
};

export const formularyPlanNamesSpec: ExtractionSpec<FormularyPlanNamesExtraction> = {
  toolName: "record_formulary_plan_names",
  description: "Record the plan names a formulary document applies to.",
  systemPrompt: `You read the cover page and front matter of a CMS Part D formulary PDF. These documents state which insurance plans they apply to, e.g. "it means True Blue Rx 32PSP, True Blue Rx 33, True Blue Rx 34" or a single plan name on the cover like "HealthSpring Extra Rx (PDP)". Extract every plan name EXACTLY as printed, including parenthetical plan-type suffixes like (HMO), (PDP), (PPO). Do not invent names, do not include the carrier's company name alone, and return an empty array if no plan names are stated.`,
  jsonSchema: PLAN_NAMES_JSON_SCHEMA,
  parse: (input) => formularyPlanNamesSchema.parse(input),
};

export const sobExtractionSpec: ExtractionSpec<SobExtraction> = {
  toolName: "record_summary_of_benefits",
  description: "Record drug cost sharing from a Summary of Benefits PDF.",
  systemPrompt: `You extract prescription-drug cost sharing from a Medicare Summary of Benefits (SB/SBC) PDF. One document may cover one or several plans — emit one plans[] element per plan, with the plan name exactly as printed.

Per plan extract:
- premiumCents: monthly plan premium in CENTS ("$0" → 0, "$45.20" → 4520); null if not stated.
- rxDeductibleCents: the Part D / pharmacy deductible in cents; 0 when the document says "no deductible"; null if not stated.
- deductibleTiers: which tiers sit behind the deductible (e.g. "does not apply to Tiers 1 and 2" with 5 tiers → [3,4,5]). Empty array when no deductible or unstated.
- insulinCapCents: the per-30-day insulin cap when stated ("won't pay more than $35" → 3500); null otherwise.
- tiers: one element per tier with its printed display label ("Preferred Generic" — strip the "Tier N:" prefix) and one costs[] element per cost cell:
  - channel mapping: a single retail column covering ALL in-network retail → standard_retail. Separate preferred/standard retail columns map respectively. Mail-order columns map to preferred_mail/standard_mail ("standard mail" vs a named preferred mail pharmacy).
  - daysSupply from the column header (30-day, 90-day, 100-day).
  - "$6" → copayCents 600. "25%" → coinsurancePct 25. "25% up to $35" → coinsurancePct 25 AND maxCents 3500. "N/A" or "not covered" → covered false with null amounts.
Copy numbers exactly as printed — never estimate, never fill gaps by analogy with other tiers.
Emit each channel + daysSupply combination AT MOST ONCE per tier. When a document has both standard and preferred mail-order columns, they are DIFFERENT channels (standard_mail and preferred_mail) even when their amounts are identical.`,
  jsonSchema: SOB_JSON_SCHEMA,
  parse: (input) => sobExtractionSchema.parse(input),
};

// ─── Shared per-call helpers ─────────────────────────────────────────────────

export const formularyPageUserText = (pageNumber: number): string =>
  `Extract the drug rows of page ${pageNumber} (1-indexed by the PDF page order of the provided document, not the printed page number). Set "page" to ${pageNumber}.`;

export const quantityLimitPageUserText = (pageNumber: number): string =>
  `Extract the quantity-limit rows of page ${pageNumber} (1-indexed by the PDF page order of the provided document, not the printed page number). Set "page" to ${pageNumber}.`;

/**
 * Models occasionally echo the printed page number; provenance must point at
 * the page that was requested.
 */
export const forcePageNumber = <T extends { page: number }>(page: T, requested: number): T =>
  page.page === requested ? page : { ...page, page: requested };
