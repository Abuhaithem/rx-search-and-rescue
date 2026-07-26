CREATE TYPE "public"."analysis_status" AS ENUM('new', 'in_review', 'approved', 'delivered');--> statement-breakpoint
CREATE TYPE "public"."cost_tier" AS ENUM('t1', 't2', 't3', 't4', 't5', 't6', 'insulin');--> statement-breakpoint
CREATE TYPE "public"."coverage_status" AS ENUM('covered', 'covered_equivalent', 'not_covered', 'not_on_formulary');--> statement-breakpoint
CREATE TYPE "public"."formulary_status" AS ENUM('ingesting', 'qa', 'active', 'superseded');--> statement-breakpoint
CREATE TYPE "public"."match_method" AS ENUM('exact_rxcui', 'ingredient_strength_form', 'brand_generic_crosswalk', 'fuzzy_name', 'manual', 'none');--> statement-breakpoint
CREATE TYPE "public"."medication_source" AS ENUM('structured', 'freetext', 'manual');--> statement-breakpoint
CREATE TYPE "public"."network_source" AS ENUM('cms', 'directory', 'agent');--> statement-breakpoint
CREATE TYPE "public"."network_status" AS ENUM('preferred', 'standard', 'out_of_network');--> statement-breakpoint
CREATE TYPE "public"."pharmacy_channel" AS ENUM('preferred_retail', 'standard_retail', 'mail_order');--> statement-breakpoint
CREATE TYPE "public"."policy_type" AS ENUM('pdp', 'ma_pd', 'med_supp', 'other');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('agent', 'manager', 'admin');--> statement-breakpoint
CREATE TABLE "analyses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"plan_year" integer NOT NULL,
	"status" "analysis_status" DEFAULT 'new' NOT NULL,
	"pricing_pharmacy_id" uuid,
	"pricing_channel_override" "pharmacy_channel",
	"assigned_to" uuid,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"report_path" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "analysis_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"analysis_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"is_current" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "analysis_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"analysis_id" uuid NOT NULL,
	"medication_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"coverage" "coverage_status" NOT NULL,
	"matched_entry_id" uuid,
	"match_method" "match_method" DEFAULT 'none' NOT NULL,
	"substitution_note" text,
	"tier" integer,
	"restrictions" jsonb,
	"needs_confirmation" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" uuid,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid,
	"meta" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "carriers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "carriers_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "client_medications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"raw_text" text NOT NULL,
	"name" text NOT NULL,
	"dosage_text" text,
	"rxcui" text,
	"strength" text,
	"form" text,
	"quantity" integer,
	"days_supply" integer,
	"generic_ok" boolean DEFAULT true NOT NULL,
	"prn" boolean DEFAULT false NOT NULL,
	"source" "medication_source" NOT NULL,
	"confidence" numeric(4, 3),
	"confirmed" boolean DEFAULT false NOT NULL,
	"position" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "client_pharmacies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"rank" integer DEFAULT 1 NOT NULL,
	"raw_text" text NOT NULL,
	"pharmacy_id" uuid,
	"match_confidence" numeric(4, 3),
	"confirmed" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "clients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"full_name" text NOT NULL,
	"external_id" text,
	"zip" text,
	"state" text,
	"county" text,
	"takes_prescriptions" boolean,
	"delivery_preferred" boolean,
	"mail_order_interest" text,
	"source_rxc_path" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "formularies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"carrier_id" uuid NOT NULL,
	"plan_year" integer NOT NULL,
	"label" text NOT NULL,
	"formulary_code" text,
	"version_date" text,
	"source_file_path" text,
	"source_page_count" integer,
	"status" "formulary_status" DEFAULT 'ingesting' NOT NULL,
	"stats" jsonb,
	"activated_by" uuid,
	"activated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "formulary_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"formulary_id" uuid NOT NULL,
	"raw_drug_name" text NOT NULL,
	"normalized_name" text,
	"rxcuis" text[] DEFAULT '{}' NOT NULL,
	"is_brand" boolean DEFAULT false NOT NULL,
	"tier" integer NOT NULL,
	"pa" boolean DEFAULT false NOT NULL,
	"st" boolean DEFAULT false NOT NULL,
	"ql_quantity" integer,
	"ql_days" integer,
	"extra_flags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"raw_requirements_text" text,
	"therapeutic_category" text,
	"source_page" integer NOT NULL,
	"confidence" numeric(4, 3),
	"needs_review" boolean DEFAULT false NOT NULL,
	"reviewed_by" uuid
);
--> statement-breakpoint
CREATE TABLE "formulary_legends" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"formulary_id" uuid NOT NULL,
	"code" text NOT NULL,
	"definition" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "in_force_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"raw_text" text NOT NULL,
	"carrier_name" text,
	"policy_number" text,
	"policy_type" "policy_type" DEFAULT 'other' NOT NULL,
	"is_current_drug_plan" boolean DEFAULT false NOT NULL,
	"matched_plan_id" uuid
);
--> statement-breakpoint
CREATE TABLE "ingestion_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"target_id" uuid,
	"progress" jsonb,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pharmacies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"npi" text,
	"name" text NOT NULL,
	"address1" text,
	"city" text,
	"state" text,
	"zip" text,
	"county" text,
	"phone" text,
	"source" text DEFAULT 'manual' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pharmacies_npi_unique" UNIQUE("npi")
);
--> statement-breakpoint
CREATE TABLE "plan_pharmacy_networks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"pharmacy_id" uuid NOT NULL,
	"status" "network_status" NOT NULL,
	"source" "network_source" NOT NULL,
	"verified_by" uuid,
	"verified_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "plan_service_areas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"state" text NOT NULL,
	"county" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plan_tier_costs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"channel" "pharmacy_channel" NOT NULL,
	"tier" "cost_tier" NOT NULL,
	"days_supply" integer NOT NULL,
	"copay_cents" integer,
	"coinsurance_pct" numeric(5, 2),
	"source_note" text,
	"verified_by" uuid,
	"verified_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"carrier_id" uuid NOT NULL,
	"formulary_id" uuid,
	"plan_year" integer NOT NULL,
	"name" text NOT NULL,
	"contract_plan_id" text,
	"premium_cents" integer,
	"rx_deductible_cents" integer,
	"deductible_tiers" integer[] DEFAULT '{}' NOT NULL,
	"curated" boolean DEFAULT true NOT NULL,
	"sob_source_path" text,
	"pharmacy_directory_path" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "profiles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"full_name" text NOT NULL,
	"role" "user_role" DEFAULT 'agent' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "report_overrides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"analysis_id" uuid NOT NULL,
	"path" text NOT NULL,
	"value" jsonb NOT NULL,
	"edited_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "zip_counties" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"zip" text NOT NULL,
	"state" text NOT NULL,
	"county" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "analyses" ADD CONSTRAINT "analyses_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analyses" ADD CONSTRAINT "analyses_pricing_pharmacy_id_pharmacies_id_fk" FOREIGN KEY ("pricing_pharmacy_id") REFERENCES "public"."pharmacies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analyses" ADD CONSTRAINT "analyses_assigned_to_profiles_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analyses" ADD CONSTRAINT "analyses_approved_by_profiles_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analyses" ADD CONSTRAINT "analyses_created_by_profiles_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_plans" ADD CONSTRAINT "analysis_plans_analysis_id_analyses_id_fk" FOREIGN KEY ("analysis_id") REFERENCES "public"."analyses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_plans" ADD CONSTRAINT "analysis_plans_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_results" ADD CONSTRAINT "analysis_results_analysis_id_analyses_id_fk" FOREIGN KEY ("analysis_id") REFERENCES "public"."analyses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_results" ADD CONSTRAINT "analysis_results_medication_id_client_medications_id_fk" FOREIGN KEY ("medication_id") REFERENCES "public"."client_medications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_results" ADD CONSTRAINT "analysis_results_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_results" ADD CONSTRAINT "analysis_results_matched_entry_id_formulary_entries_id_fk" FOREIGN KEY ("matched_entry_id") REFERENCES "public"."formulary_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_id_profiles_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_medications" ADD CONSTRAINT "client_medications_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_pharmacies" ADD CONSTRAINT "client_pharmacies_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_pharmacies" ADD CONSTRAINT "client_pharmacies_pharmacy_id_pharmacies_id_fk" FOREIGN KEY ("pharmacy_id") REFERENCES "public"."pharmacies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_created_by_profiles_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "formularies" ADD CONSTRAINT "formularies_carrier_id_carriers_id_fk" FOREIGN KEY ("carrier_id") REFERENCES "public"."carriers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "formularies" ADD CONSTRAINT "formularies_activated_by_profiles_id_fk" FOREIGN KEY ("activated_by") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "formulary_entries" ADD CONSTRAINT "formulary_entries_formulary_id_formularies_id_fk" FOREIGN KEY ("formulary_id") REFERENCES "public"."formularies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "formulary_entries" ADD CONSTRAINT "formulary_entries_reviewed_by_profiles_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "formulary_legends" ADD CONSTRAINT "formulary_legends_formulary_id_formularies_id_fk" FOREIGN KEY ("formulary_id") REFERENCES "public"."formularies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "in_force_policies" ADD CONSTRAINT "in_force_policies_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "in_force_policies" ADD CONSTRAINT "in_force_policies_matched_plan_id_plans_id_fk" FOREIGN KEY ("matched_plan_id") REFERENCES "public"."plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_pharmacy_networks" ADD CONSTRAINT "plan_pharmacy_networks_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_pharmacy_networks" ADD CONSTRAINT "plan_pharmacy_networks_pharmacy_id_pharmacies_id_fk" FOREIGN KEY ("pharmacy_id") REFERENCES "public"."pharmacies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_pharmacy_networks" ADD CONSTRAINT "plan_pharmacy_networks_verified_by_profiles_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_service_areas" ADD CONSTRAINT "plan_service_areas_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_tier_costs" ADD CONSTRAINT "plan_tier_costs_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_tier_costs" ADD CONSTRAINT "plan_tier_costs_verified_by_profiles_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plans" ADD CONSTRAINT "plans_carrier_id_carriers_id_fk" FOREIGN KEY ("carrier_id") REFERENCES "public"."carriers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plans" ADD CONSTRAINT "plans_formulary_id_formularies_id_fk" FOREIGN KEY ("formulary_id") REFERENCES "public"."formularies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_overrides" ADD CONSTRAINT "report_overrides_analysis_id_analyses_id_fk" FOREIGN KEY ("analysis_id") REFERENCES "public"."analyses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_overrides" ADD CONSTRAINT "report_overrides_edited_by_profiles_id_fk" FOREIGN KEY ("edited_by") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "analyses_status_idx" ON "analyses" USING btree ("status");--> statement-breakpoint
CREATE INDEX "analyses_client_idx" ON "analyses" USING btree ("client_id");--> statement-breakpoint
CREATE UNIQUE INDEX "analysis_plans_uq" ON "analysis_plans" USING btree ("analysis_id","plan_id");--> statement-breakpoint
CREATE INDEX "analysis_results_analysis_idx" ON "analysis_results" USING btree ("analysis_id");--> statement-breakpoint
CREATE UNIQUE INDEX "analysis_results_uq" ON "analysis_results" USING btree ("analysis_id","medication_id","plan_id");--> statement-breakpoint
CREATE INDEX "audit_events_entity_idx" ON "audit_events" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "client_medications_client_idx" ON "client_medications" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "client_pharmacies_client_idx" ON "client_pharmacies" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "formularies_carrier_year_idx" ON "formularies" USING btree ("carrier_id","plan_year");--> statement-breakpoint
CREATE INDEX "formulary_entries_formulary_idx" ON "formulary_entries" USING btree ("formulary_id");--> statement-breakpoint
CREATE INDEX "formulary_entries_normalized_idx" ON "formulary_entries" USING btree ("formulary_id","normalized_name");--> statement-breakpoint
CREATE INDEX "pharmacies_zip_idx" ON "pharmacies" USING btree ("zip");--> statement-breakpoint
CREATE INDEX "pharmacies_name_idx" ON "pharmacies" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "plan_pharmacy_networks_uq" ON "plan_pharmacy_networks" USING btree ("plan_id","pharmacy_id");--> statement-breakpoint
CREATE UNIQUE INDEX "plan_service_areas_uq" ON "plan_service_areas" USING btree ("plan_id","state","county");--> statement-breakpoint
CREATE UNIQUE INDEX "plan_tier_costs_uq" ON "plan_tier_costs" USING btree ("plan_id","channel","tier","days_supply");--> statement-breakpoint
CREATE INDEX "plans_year_idx" ON "plans" USING btree ("plan_year");--> statement-breakpoint
CREATE UNIQUE INDEX "plans_carrier_name_year_uq" ON "plans" USING btree ("carrier_id","name","plan_year");--> statement-breakpoint
CREATE UNIQUE INDEX "report_overrides_uq" ON "report_overrides" USING btree ("analysis_id","path");--> statement-breakpoint
CREATE INDEX "zip_counties_zip_idx" ON "zip_counties" USING btree ("zip");--> statement-breakpoint
CREATE UNIQUE INDEX "zip_counties_uq" ON "zip_counties" USING btree ("zip","state","county");