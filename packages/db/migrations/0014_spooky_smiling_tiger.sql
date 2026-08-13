CREATE TYPE "public"."lis_category" AS ENUM('full_medicaid_le_100_fpl', 'full_medicaid_gt_100_fpl', 'institutional_or_hcbs', 'other_full_lis');--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "lis_category" "lis_category";--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "lis_cost_sharing" boolean DEFAULT false NOT NULL;