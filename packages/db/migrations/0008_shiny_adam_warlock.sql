ALTER TABLE "plan_tier_costs" ADD COLUMN "max_cents" integer;--> statement-breakpoint
ALTER TABLE "plan_tier_costs" ADD COLUMN "staged" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "sob_path" text;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "sob_staged" jsonb;