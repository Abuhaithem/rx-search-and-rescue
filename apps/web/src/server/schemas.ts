/**
 * Zod input schemas for server actions. Lives outside the "use server" files
 * so screens can import the inferred input types for their forms.
 */
import { z } from "zod";

export const medicationInputSchema = z.object({
  id: z.string().uuid().optional(), // present = update existing row; absent = manual add
  name: z.string().min(1),
  dosageText: z.string().nullish(),
  rxcui: z.string().nullish(),
  strength: z.string().nullish(),
  form: z.string().nullish(),
  quantity: z.number().int().positive().nullish(),
  daysSupply: z.number().int().positive().nullish(),
  genericOk: z.boolean().default(true),
  prn: z.boolean().default(false),
  position: z.number().int().min(0).default(0),
  rawText: z.string().optional(),
});
export type MedicationInput = z.input<typeof medicationInputSchema>;

export const pharmacyInputSchema = z.object({
  id: z.string().uuid().optional(),
  rank: z.number().int().min(1).max(3).default(1),
  rawText: z.string().min(1),
  pharmacyId: z.string().uuid().nullish(),
});
export type PharmacyInput = z.input<typeof pharmacyInputSchema>;

export const policyInputSchema = z.object({
  id: z.string().uuid().optional(),
  rawText: z.string().min(1),
  carrierName: z.string().nullish(),
  policyNumber: z.string().nullish(),
  policyType: z.enum(["pdp", "ma_pd", "med_supp", "other"]).default("other"),
  isCurrentDrugPlan: z.boolean().default(false),
  matchedPlanId: z.string().uuid().nullish(),
});
export type PolicyInput = z.input<typeof policyInputSchema>;

export const clientFieldsSchema = z.object({
  fullName: z.string().min(1),
  externalId: z.string().nullish(),
  zip: z
    .string()
    .regex(/^\d{5}$/)
    .nullish(),
  state: z.string().length(2).nullish(),
  county: z.string().nullish(),
  takesPrescriptions: z.boolean().nullish(),
  deliveryPreferred: z.boolean().nullish(),
  mailOrderInterest: z.enum(["yes", "no"]).nullish(),
});
export type ClientFieldsInput = z.input<typeof clientFieldsSchema>;

export const confirmIntakeSchema = z.object({
  client: clientFieldsSchema,
  planYear: z.number().int().min(2020).max(2100),
  medications: z.array(medicationInputSchema),
  pharmacies: z.array(pharmacyInputSchema),
  policies: z.array(policyInputSchema),
});
export type ConfirmIntakeInput = z.input<typeof confirmIntakeSchema>;

export const manualClientSchema = z.object({
  client: clientFieldsSchema,
  medications: z.array(medicationInputSchema).default([]),
  pharmacies: z.array(pharmacyInputSchema).default([]),
  policies: z.array(policyInputSchema).default([]),
});
export type ManualClientInput = z.input<typeof manualClientSchema>;

export const pharmacyChannelSchema = z.enum([
  "preferred_retail",
  "standard_retail",
  "preferred_mail",
  "standard_mail",
]);

export const networkStatusSchema = z.enum(["preferred", "standard", "out_of_network"]);

export const costTierSchema = z.enum(["t1", "t2", "t3", "t4", "t5", "t6", "insulin"]);

export const tierCostRowSchema = z
  .object({
    channel: pharmacyChannelSchema,
    tier: costTierSchema,
    daysSupply: z.number().int().positive(),
    copayCents: z.number().int().min(0).nullable(),
    coinsurancePct: z.number().min(0).max(100).nullable(),
    sourceNote: z.string().nullish(),
  })
  .refine((row) => (row.copayCents == null) !== (row.coinsurancePct == null), {
    message: "Exactly one of copayCents / coinsurancePct must be set",
  });
export type TierCostRowInput = z.input<typeof tierCostRowSchema>;

export const planUpsertSchema = z
  .object({
    id: z.string().uuid().optional(),
    carrierId: z.string().uuid().optional(),
    carrierName: z.string().min(1).optional(),
    formularyId: z.string().uuid().nullish(),
    planYear: z.number().int().min(2020).max(2100),
    name: z.string().min(1),
    contractPlanId: z.string().nullish(),
    premiumCents: z.number().int().min(0).nullish(),
    rxDeductibleCents: z.number().int().min(0).nullish(),
    deductibleTiers: z.array(z.number().int().min(1).max(6)).optional(),
    curated: z.boolean().optional(),
    /** Per-plan SoB tier display labels; empty strings are dropped on save. */
    tierLabels: z
      .object({
        t1: z.string().max(60).optional(),
        t2: z.string().max(60).optional(),
        t3: z.string().max(60).optional(),
        t4: z.string().max(60).optional(),
        t5: z.string().max(60).optional(),
        t6: z.string().max(60).optional(),
        insulin: z.string().max(60).optional(),
      })
      .optional(),
  })
  .refine((p) => p.carrierId != null || p.carrierName != null, {
    message: "carrierId or carrierName is required",
  });
export type PlanUpsertInput = z.input<typeof planUpsertSchema>;

export const serviceAreaSchema = z.object({
  state: z.string().length(2),
  county: z.string().min(1),
});
export type ServiceAreaInput = z.input<typeof serviceAreaSchema>;

/**
 * QA decision for a needs-review formulary entry. The schema stores one
 * reading per entry, so "pick reading A/B" maps to accept-as-extracted vs
 * edit-with-corrections; "remove" drops a hallucinated row.
 */
export const reviewDecisionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("accept") }),
  z.object({
    action: z.literal("edit"),
    rawDrugName: z.string().min(1).optional(),
    normalizedName: z.string().nullish(),
    tier: z.number().int().min(1).max(6).optional(),
    isBrand: z.boolean().optional(),
    pa: z.boolean().optional(),
    st: z.boolean().optional(),
    qlQuantity: z.number().int().positive().nullish(),
    qlDays: z.number().int().positive().nullish(),
    extraFlags: z.array(z.string()).optional(),
  }),
  z.object({ action: z.literal("remove") }),
]);
export type ReviewDecision = z.input<typeof reviewDecisionSchema>;

/** Only paths applyOverrides() understands are storable. */
export const overridePathSchema = z
  .string()
  .regex(/^(agentNotes|deductibleFootnote|grid\.\d+\.\d+\.display)$/, "Unknown override path");
