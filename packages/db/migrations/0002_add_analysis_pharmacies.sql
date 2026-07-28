CREATE TABLE "analysis_pharmacies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"analysis_id" uuid NOT NULL,
	"pharmacy_id" uuid NOT NULL,
	"position" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "analyses" ALTER COLUMN "pricing_channel_override" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "plan_tier_costs" ALTER COLUMN "channel" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "public"."pharmacy_channel";--> statement-breakpoint
CREATE TYPE "public"."pharmacy_channel" AS ENUM('preferred_retail', 'standard_retail', 'preferred_mail', 'standard_mail');--> statement-breakpoint
UPDATE "plan_tier_costs" SET "channel" = 'standard_mail' WHERE "channel" = 'mail_order';--> statement-breakpoint
UPDATE "analyses" SET "pricing_channel_override" = 'standard_mail' WHERE "pricing_channel_override" = 'mail_order';--> statement-breakpoint
ALTER TABLE "analyses" ALTER COLUMN "pricing_channel_override" SET DATA TYPE "public"."pharmacy_channel" USING "pricing_channel_override"::"public"."pharmacy_channel";--> statement-breakpoint
ALTER TABLE "plan_tier_costs" ALTER COLUMN "channel" SET DATA TYPE "public"."pharmacy_channel" USING "channel"::"public"."pharmacy_channel";--> statement-breakpoint
ALTER TABLE "analyses" ADD COLUMN "include_mail_order" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "analysis_pharmacies" ADD CONSTRAINT "analysis_pharmacies_analysis_id_analyses_id_fk" FOREIGN KEY ("analysis_id") REFERENCES "public"."analyses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_pharmacies" ADD CONSTRAINT "analysis_pharmacies_pharmacy_id_pharmacies_id_fk" FOREIGN KEY ("pharmacy_id") REFERENCES "public"."pharmacies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "analysis_pharmacies_uq" ON "analysis_pharmacies" USING btree ("analysis_id","pharmacy_id");