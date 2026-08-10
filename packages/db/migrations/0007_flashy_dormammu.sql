ALTER TABLE "carriers" ADD COLUMN "logo_path" text;--> statement-breakpoint
ALTER TABLE "plan_pharmacy_networks" ADD COLUMN "staged" boolean DEFAULT false NOT NULL;