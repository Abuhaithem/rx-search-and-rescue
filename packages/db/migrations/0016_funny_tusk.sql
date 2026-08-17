CREATE TABLE "drug_aliases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"alias" text NOT NULL,
	"generic_name" text NOT NULL,
	"is_combination" boolean DEFAULT false NOT NULL,
	"components" text[] DEFAULT '{}' NOT NULL,
	"source" text DEFAULT 'llm' NOT NULL,
	"confidence" numeric(4, 3),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "drug_aliases_alias_unique" UNIQUE("alias")
);
--> statement-breakpoint
ALTER TABLE "client_medications" ADD COLUMN "resolved_generic_name" text;--> statement-breakpoint
ALTER TABLE "client_medications" ADD COLUMN "resolution_method" text;