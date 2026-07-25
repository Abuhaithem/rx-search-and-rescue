/**
 * Contracts for AI-assisted intake extraction (RxC PDF → structured data).
 * These zod schemas are the EXACT JSON schema given to Claude for structured
 * output, and the validation gate before anything is written to the DB.
 * Everything AI-extracted lands as unconfirmed; the Intake Review screen is
 * the trust checkpoint that flips `confirmed`.
 */
import { z } from "zod";

export const extractedMedicationSchema = z.object({
  /** Short name column, e.g. "Eliquis", "losartan potassium". */
  name: z.string().min(1),
  /** Full dosage description, e.g. "Eliquis TAB 2.5MG". */
  dosageText: z.string().nullable(),
  quantity: z.number().int().positive().nullable(),
  /** Refill frequency in days (30/60/90…). */
  daysSupply: z.number().int().positive().nullable(),
  genericOk: z.boolean().nullable(),
  /** True when annotated "(prn)" / "as needed". */
  prn: z.boolean().default(false),
  /** "structured" = from the prescriptions table; "freetext" = from Additional Information. */
  source: z.enum(["structured", "freetext"]),
  /** Extractor's own confidence 0–1; freetext rows should rarely exceed 0.8. */
  confidence: z.number().min(0).max(1),
  /** Verbatim source text for provenance. */
  rawText: z.string().min(1),
});

export const extractedPolicySchema = z.object({
  rawText: z.string().min(1),
  carrierName: z.string().nullable(),
  policyNumber: z.string().nullable(),
  policyType: z.enum(["pdp", "ma_pd", "med_supp", "other"]),
});

export const rxcExtractionSchema = z.object({
  clientName: z.string().min(1),
  zip: z.string().regex(/^\d{5}$/).nullable(),
  takesPrescriptions: z.boolean().nullable(),
  /** Raw preferred-pharmacy strings, in form order, max 3. */
  preferredPharmacies: z.array(z.string().min(1)).max(3),
  deliveryPreferred: z.boolean().nullable(),
  medications: z.array(extractedMedicationSchema),
  inForcePolicies: z.array(extractedPolicySchema),
});

export type ExtractedMedication = z.infer<typeof extractedMedicationSchema>;
export type ExtractedPolicy = z.infer<typeof extractedPolicySchema>;
export type RxcExtraction = z.infer<typeof rxcExtractionSchema>;

/** One extracted formulary drug row (per-page extraction contract). */
export const formularyRowSchema = z.object({
  rawDrugName: z.string().min(1),
  tier: z.number().int().min(1).max(6),
  /** Verbatim requirements string, e.g. "PA; QL (60 per 30 days); NM". */
  requirementsText: z.string().nullable(),
  therapeuticCategory: z.string().nullable(),
});

export const formularyPageSchema = z.object({
  page: z.number().int().positive(),
  rows: z.array(formularyRowSchema),
});

export type FormularyRow = z.infer<typeof formularyRowSchema>;
export type FormularyPage = z.infer<typeof formularyPageSchema>;
