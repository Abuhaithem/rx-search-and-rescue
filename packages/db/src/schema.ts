import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

// ─── Enums ───────────────────────────────────────────────────────────────────

export const userRole = pgEnum("user_role", ["agent", "manager", "admin"]);

export const formularyStatus = pgEnum("formulary_status", [
  "ingesting",
  "qa",
  "active",
  "superseded",
]);

export const pharmacyChannel = pgEnum("pharmacy_channel", [
  "preferred_retail",
  "standard_retail",
  "mail_order",
]);

export const networkStatus = pgEnum("network_status", [
  "preferred",
  "standard",
  "out_of_network",
]);

export const networkSource = pgEnum("network_source", [
  "cms",
  "directory",
  "agent",
]);

export const costTier = pgEnum("cost_tier", [
  "t1",
  "t2",
  "t3",
  "t4",
  "t5",
  "t6",
  "insulin",
]);

export const policyType = pgEnum("policy_type", [
  "pdp",
  "ma_pd",
  "med_supp",
  "other",
]);

export const medicationSource = pgEnum("medication_source", [
  "structured",
  "freetext",
  "manual",
]);

export const analysisStatus = pgEnum("analysis_status", [
  "new",
  "in_review",
  "approved",
  "delivered",
]);

export const coverageStatus = pgEnum("coverage_status", [
  "covered",
  "covered_equivalent", // Generic OK crosswalk: prescribed form not on formulary, equivalent is
  "not_covered",
  "not_on_formulary",
]);

export const matchMethod = pgEnum("match_method", [
  "exact_rxcui",
  "ingredient_strength_form",
  "brand_generic_crosswalk",
  "fuzzy_name",
  "manual",
  "none",
]);

// ─── Auth-adjacent ───────────────────────────────────────────────────────────

/** Mirrors supabase auth.users; row created by trigger on signup. */
export const profiles = pgTable("profiles", {
  id: uuid("id").primaryKey(), // = auth.users.id
  fullName: text("full_name").notNull(),
  role: userRole("role").notNull().default("agent"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ─── Reference data: carriers, formularies, plans ────────────────────────────

export const carriers = pgTable("carriers", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** One row per formulary DOCUMENT edition. Many plans may share one formulary. */
export const formularies = pgTable(
  "formularies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    carrierId: uuid("carrier_id").notNull().references(() => carriers.id),
    planYear: integer("plan_year").notNull(),
    label: text("label").notNull(), // e.g. "2026 True Blue Rx (all True Blue plans)"
    formularyCode: text("formulary_code"), // e.g. "00026046 V08"
    versionDate: text("version_date"), // as printed, e.g. "01/01/2026"
    sourceFilePath: text("source_file_path"), // Supabase Storage path of the PDF
    sourcePageCount: integer("source_page_count"),
    status: formularyStatus("status").notNull().default("ingesting"),
    /** Extraction stats for the admin QA screen. */
    stats: jsonb("stats").$type<{
      totalEntries?: number;
      indexCount?: number; // count from the document's own alphabetical index
      needsReview?: number;
    }>(),
    activatedBy: uuid("activated_by").references(() => profiles.id),
    activatedAt: timestamp("activated_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("formularies_carrier_year_idx").on(t.carrierId, t.planYear)],
);

export const formularyEntries = pgTable(
  "formulary_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    formularyId: uuid("formulary_id")
      .notNull()
      .references(() => formularies.id, { onDelete: "cascade" }),
    rawDrugName: text("raw_drug_name").notNull(), // exactly as printed
    normalizedName: text("normalized_name"), // lowercased, single-strength
    rxcuis: text("rxcuis").array().notNull().default([]),
    isBrand: boolean("is_brand").notNull().default(false), // UPPERCASE rows = brand
    tier: integer("tier").notNull(),
    pa: boolean("pa").notNull().default(false),
    st: boolean("st").notNull().default(false),
    qlQuantity: integer("ql_quantity"),
    qlDays: integer("ql_days"),
    /** Carrier-specific codes preserved verbatim: ["NM","NEDS","B/D PA"] */
    extraFlags: jsonb("extra_flags").$type<string[]>().notNull().default([]),
    rawRequirementsText: text("raw_requirements_text"), // e.g. "PA; QL (60 per 30 days); NM"
    therapeuticCategory: text("therapeutic_category"),
    sourcePage: integer("source_page").notNull(),
    confidence: numeric("confidence", { precision: 4, scale: 3 }), // 0.000–1.000
    needsReview: boolean("needs_review").notNull().default(false),
    reviewedBy: uuid("reviewed_by").references(() => profiles.id),
  },
  (t) => [
    index("formulary_entries_formulary_idx").on(t.formularyId),
    index("formulary_entries_normalized_idx").on(t.formularyId, t.normalizedName),
  ],
);

/** Legend/abbreviation key per formulary: code → carrier's own definition. */
export const formularyLegends = pgTable("formulary_legends", {
  id: uuid("id").primaryKey().defaultRandom(),
  formularyId: uuid("formulary_id")
    .notNull()
    .references(() => formularies.id, { onDelete: "cascade" }),
  code: text("code").notNull(),
  definition: text("definition").notNull(),
});

export const plans = pgTable(
  "plans",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    carrierId: uuid("carrier_id").notNull().references(() => carriers.id),
    formularyId: uuid("formulary_id").references(() => formularies.id),
    planYear: integer("plan_year").notNull(),
    name: text("name").notNull(), // e.g. "True Blue Rx 33 (HMO)"
    contractPlanId: text("contract_plan_id"), // e.g. "H1350-033"
    premiumCents: integer("premium_cents"),
    rxDeductibleCents: integer("rx_deductible_cents"),
    /** Which tiers the deductible applies to, e.g. [3,4,5]. */
    deductibleTiers: integer("deductible_tiers").array().notNull().default([]),
    /** Agency curation: only curated plans surface by default on plan select. */
    curated: boolean("curated").notNull().default(true),
    sobSourcePath: text("sob_source_path"), // Summary of Benefits PDF in Storage
    pharmacyDirectoryPath: text("pharmacy_directory_path"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("plans_year_idx").on(t.planYear),
    uniqueIndex("plans_carrier_name_year_uq").on(t.carrierId, t.name, t.planYear),
  ],
);

export const planServiceAreas = pgTable(
  "plan_service_areas",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    planId: uuid("plan_id")
      .notNull()
      .references(() => plans.id, { onDelete: "cascade" }),
    state: text("state").notNull(), // "ID"
    county: text("county").notNull(), // "Blaine"
  },
  (t) => [uniqueIndex("plan_service_areas_uq").on(t.planId, t.state, t.county)],
);

/**
 * Summary-of-Benefits cost sharing. One row per (plan, channel, tier).
 * Exactly one of copayCents / coinsurancePct is set.
 */
export const planTierCosts = pgTable(
  "plan_tier_costs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    planId: uuid("plan_id")
      .notNull()
      .references(() => plans.id, { onDelete: "cascade" }),
    channel: pharmacyChannel("channel").notNull(),
    tier: costTier("tier").notNull(),
    daysSupply: integer("days_supply").notNull(), // 30 retail, 90 mail order
    copayCents: integer("copay_cents"),
    coinsurancePct: numeric("coinsurance_pct", { precision: 5, scale: 2 }),
    sourceNote: text("source_note"), // e.g. "2027 True Blue SoB p.4"
    verifiedBy: uuid("verified_by").references(() => profiles.id),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("plan_tier_costs_uq").on(t.planId, t.channel, t.tier, t.daysSupply)],
);

// ─── ZIP → county ────────────────────────────────────────────────────────────

export const zipCounties = pgTable(
  "zip_counties",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    zip: text("zip").notNull(),
    state: text("state").notNull(),
    county: text("county").notNull(),
  },
  (t) => [index("zip_counties_zip_idx").on(t.zip), uniqueIndex("zip_counties_uq").on(t.zip, t.state, t.county)],
);

// ─── Pharmacies ──────────────────────────────────────────────────────────────

export const pharmacies = pgTable(
  "pharmacies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    npi: text("npi").unique(),
    name: text("name").notNull(),
    /** DBA / storefront names from NPPES other_names — clients write these on RxC forms. */
    altNames: text("alt_names").array().notNull().default([]),
    address1: text("address1"),
    city: text("city"),
    state: text("state"),
    zip: text("zip"),
    county: text("county"),
    phone: text("phone"),
    source: text("source").notNull().default("manual"), // nppes | manual
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("pharmacies_zip_idx").on(t.zip), index("pharmacies_name_idx").on(t.name)],
);

/** Per-plan network status for a pharmacy — versioned implicitly by the plan's year. */
export const planPharmacyNetworks = pgTable(
  "plan_pharmacy_networks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    planId: uuid("plan_id")
      .notNull()
      .references(() => plans.id, { onDelete: "cascade" }),
    pharmacyId: uuid("pharmacy_id")
      .notNull()
      .references(() => pharmacies.id, { onDelete: "cascade" }),
    status: networkStatus("status").notNull(),
    source: networkSource("source").notNull(),
    verifiedBy: uuid("verified_by").references(() => profiles.id),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("plan_pharmacy_networks_uq").on(t.planId, t.pharmacyId)],
);

// ─── Clients & intake ────────────────────────────────────────────────────────

export const clients = pgTable("clients", {
  id: uuid("id").primaryKey().defaultRandom(),
  fullName: text("full_name").notNull(),
  externalId: text("external_id"), // AgencyBloc individual id if known
  zip: text("zip"),
  state: text("state"),
  county: text("county"), // confirmed county for multi-county ZIPs
  takesPrescriptions: boolean("takes_prescriptions"),
  deliveryPreferred: boolean("delivery_preferred"),
  mailOrderInterest: text("mail_order_interest"), // "yes" | "no" | "ask_client"
  sourceRxcPath: text("source_rxc_path"), // uploaded RxC PDF in Storage
  createdBy: uuid("created_by").references(() => profiles.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const clientPharmacies = pgTable(
  "client_pharmacies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    rank: integer("rank").notNull().default(1), // RxC allows up to 3
    rawText: text("raw_text").notNull(), // "The Drug Store - 91 E Croy Hailey ID 83333"
    pharmacyId: uuid("pharmacy_id").references(() => pharmacies.id),
    matchConfidence: numeric("match_confidence", { precision: 4, scale: 3 }),
    confirmed: boolean("confirmed").notNull().default(false),
  },
  (t) => [index("client_pharmacies_client_idx").on(t.clientId)],
);

export const clientMedications = pgTable(
  "client_medications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    rawText: text("raw_text").notNull(), // as parsed/entered
    name: text("name").notNull(), // display name, e.g. "Eliquis"
    dosageText: text("dosage_text"), // "Eliquis TAB 2.5MG"
    rxcui: text("rxcui"),
    strength: text("strength"),
    form: text("form"),
    quantity: integer("quantity"),
    daysSupply: integer("days_supply"),
    genericOk: boolean("generic_ok").notNull().default(true),
    prn: boolean("prn").notNull().default(false),
    source: medicationSource("source").notNull(),
    confidence: numeric("confidence", { precision: 4, scale: 3 }),
    confirmed: boolean("confirmed").notNull().default(false),
    position: integer("position").notNull().default(0),
  },
  (t) => [index("client_medications_client_idx").on(t.clientId)],
);

export const inForcePolicies = pgTable("in_force_policies", {
  id: uuid("id").primaryKey().defaultRandom(),
  clientId: uuid("client_id")
    .notNull()
    .references(() => clients.id, { onDelete: "cascade" }),
  rawText: text("raw_text").notNull(), // "Humana - H94324997 - PDP"
  carrierName: text("carrier_name"),
  policyNumber: text("policy_number"),
  policyType: policyType("policy_type").notNull().default("other"),
  /** True for the one drug-plan policy used as the "current plan" column. */
  isCurrentDrugPlan: boolean("is_current_drug_plan").notNull().default(false),
  matchedPlanId: uuid("matched_plan_id").references(() => plans.id),
});

// ─── Analyses ────────────────────────────────────────────────────────────────

export const analyses = pgTable(
  "analyses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    planYear: integer("plan_year").notNull(),
    status: analysisStatus("status").notNull().default("new"),
    /** Pricing context chosen on the grid. */
    pricingPharmacyId: uuid("pricing_pharmacy_id").references(() => pharmacies.id),
    pricingChannelOverride: pharmacyChannel("pricing_channel_override"), // null = client's pharmacy
    assignedTo: uuid("assigned_to").references(() => profiles.id),
    approvedBy: uuid("approved_by").references(() => profiles.id),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    reportPath: text("report_path"), // generated .docx in Storage
    createdBy: uuid("created_by").references(() => profiles.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("analyses_status_idx").on(t.status), index("analyses_client_idx").on(t.clientId)],
);

export const analysisPlans = pgTable(
  "analysis_plans",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    analysisId: uuid("analysis_id")
      .notNull()
      .references(() => analyses.id, { onDelete: "cascade" }),
    planId: uuid("plan_id").notNull().references(() => plans.id),
    position: integer("position").notNull().default(0),
    isCurrent: boolean("is_current").notNull().default(false),
  },
  (t) => [uniqueIndex("analysis_plans_uq").on(t.analysisId, t.planId)],
);

/** One row per medication × plan — the comparison grid cell, with provenance. */
export const analysisResults = pgTable(
  "analysis_results",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    analysisId: uuid("analysis_id")
      .notNull()
      .references(() => analyses.id, { onDelete: "cascade" }),
    medicationId: uuid("medication_id")
      .notNull()
      .references(() => clientMedications.id, { onDelete: "cascade" }),
    planId: uuid("plan_id").notNull().references(() => plans.id),
    coverage: coverageStatus("coverage").notNull(),
    matchedEntryId: uuid("matched_entry_id").references(() => formularyEntries.id),
    matchMethod: matchMethod("match_method").notNull().default("none"),
    /** Note shown when coverage = covered_equivalent, e.g. "Generic is Not Cov · brand covered". */
    substitutionNote: text("substitution_note"),
    tier: integer("tier"),
    restrictions: jsonb("restrictions").$type<{
      pa?: boolean;
      st?: boolean;
      ql?: { quantity: number; days: number };
      extraFlags?: string[];
    }>(),
    needsConfirmation: boolean("needs_confirmation").notNull().default(false),
  },
  (t) => [
    index("analysis_results_analysis_idx").on(t.analysisId),
    uniqueIndex("analysis_results_uq").on(t.analysisId, t.medicationId, t.planId),
  ],
);

/** Agent edits stored as overrides on top of generated data; survive regeneration. */
export const reportOverrides = pgTable(
  "report_overrides",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    analysisId: uuid("analysis_id")
      .notNull()
      .references(() => analyses.id, { onDelete: "cascade" }),
    /** Dot-path into the report model, e.g. "notes", "grid.<medId>.<planId>.display" */
    path: text("path").notNull(),
    value: jsonb("value").notNull(),
    editedBy: uuid("edited_by").references(() => profiles.id),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("report_overrides_uq").on(t.analysisId, t.path)],
);

// ─── Audit ───────────────────────────────────────────────────────────────────

export const auditEvents = pgTable(
  "audit_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actorId: uuid("actor_id").references(() => profiles.id),
    action: text("action").notNull(), // "analysis.approved", "formulary.activated", …
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id"),
    meta: jsonb("meta").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("audit_events_entity_idx").on(t.entityType, t.entityId)],
);

// ─── Ingestion jobs (worker bookkeeping, drives admin progress UI) ───────────

export const ingestionJobs = pgTable("ingestion_jobs", {
  id: uuid("id").primaryKey().defaultRandom(),
  kind: text("kind").notNull(), // "formulary" | "rxc" | "pharmacy_directory" | "nppes_seed"
  status: text("status").notNull().default("queued"), // queued | running | done | failed
  targetId: uuid("target_id"), // formularyId / clientId / planId
  progress: jsonb("progress").$type<{ page?: number; totalPages?: number; message?: string }>(),
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ─── Relations (query-layer convenience) ─────────────────────────────────────

export const carriersRelations = relations(carriers, ({ many }) => ({
  formularies: many(formularies),
  plans: many(plans),
}));

export const formulariesRelations = relations(formularies, ({ one, many }) => ({
  carrier: one(carriers, { fields: [formularies.carrierId], references: [carriers.id] }),
  entries: many(formularyEntries),
  legends: many(formularyLegends),
  plans: many(plans),
}));

export const formularyEntriesRelations = relations(formularyEntries, ({ one }) => ({
  formulary: one(formularies, {
    fields: [formularyEntries.formularyId],
    references: [formularies.id],
  }),
}));

export const formularyLegendsRelations = relations(formularyLegends, ({ one }) => ({
  formulary: one(formularies, {
    fields: [formularyLegends.formularyId],
    references: [formularies.id],
  }),
}));

export const plansRelations = relations(plans, ({ one, many }) => ({
  carrier: one(carriers, { fields: [plans.carrierId], references: [carriers.id] }),
  formulary: one(formularies, { fields: [plans.formularyId], references: [formularies.id] }),
  serviceAreas: many(planServiceAreas),
  tierCosts: many(planTierCosts),
  pharmacyNetworks: many(planPharmacyNetworks),
}));

export const planServiceAreasRelations = relations(planServiceAreas, ({ one }) => ({
  plan: one(plans, { fields: [planServiceAreas.planId], references: [plans.id] }),
}));

export const planTierCostsRelations = relations(planTierCosts, ({ one }) => ({
  plan: one(plans, { fields: [planTierCosts.planId], references: [plans.id] }),
}));

export const pharmaciesRelations = relations(pharmacies, ({ many }) => ({
  planNetworks: many(planPharmacyNetworks),
}));

export const planPharmacyNetworksRelations = relations(planPharmacyNetworks, ({ one }) => ({
  plan: one(plans, { fields: [planPharmacyNetworks.planId], references: [plans.id] }),
  pharmacy: one(pharmacies, {
    fields: [planPharmacyNetworks.pharmacyId],
    references: [pharmacies.id],
  }),
}));

export const clientsRelations = relations(clients, ({ many }) => ({
  medications: many(clientMedications),
  pharmacies: many(clientPharmacies),
  policies: many(inForcePolicies),
  analyses: many(analyses),
}));

export const clientPharmaciesRelations = relations(clientPharmacies, ({ one }) => ({
  client: one(clients, { fields: [clientPharmacies.clientId], references: [clients.id] }),
  pharmacy: one(pharmacies, { fields: [clientPharmacies.pharmacyId], references: [pharmacies.id] }),
}));

export const clientMedicationsRelations = relations(clientMedications, ({ one }) => ({
  client: one(clients, { fields: [clientMedications.clientId], references: [clients.id] }),
}));

export const inForcePoliciesRelations = relations(inForcePolicies, ({ one }) => ({
  client: one(clients, { fields: [inForcePolicies.clientId], references: [clients.id] }),
  matchedPlan: one(plans, { fields: [inForcePolicies.matchedPlanId], references: [plans.id] }),
}));

export const analysesRelations = relations(analyses, ({ one, many }) => ({
  client: one(clients, { fields: [analyses.clientId], references: [clients.id] }),
  plans: many(analysisPlans),
  results: many(analysisResults),
  overrides: many(reportOverrides),
  pricingPharmacy: one(pharmacies, {
    fields: [analyses.pricingPharmacyId],
    references: [pharmacies.id],
  }),
}));

export const analysisPlansRelations = relations(analysisPlans, ({ one }) => ({
  analysis: one(analyses, { fields: [analysisPlans.analysisId], references: [analyses.id] }),
  plan: one(plans, { fields: [analysisPlans.planId], references: [plans.id] }),
}));

export const analysisResultsRelations = relations(analysisResults, ({ one }) => ({
  analysis: one(analyses, { fields: [analysisResults.analysisId], references: [analyses.id] }),
  medication: one(clientMedications, {
    fields: [analysisResults.medicationId],
    references: [clientMedications.id],
  }),
  plan: one(plans, { fields: [analysisResults.planId], references: [plans.id] }),
  matchedEntry: one(formularyEntries, {
    fields: [analysisResults.matchedEntryId],
    references: [formularyEntries.id],
  }),
}));

export const reportOverridesRelations = relations(reportOverrides, ({ one }) => ({
  analysis: one(analyses, { fields: [reportOverrides.analysisId], references: [analyses.id] }),
}));
