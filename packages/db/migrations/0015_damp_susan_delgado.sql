CREATE TABLE "pharmacy_brands" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"normalized_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pharmacy_brands_normalized_name_unique" UNIQUE("normalized_name")
);
--> statement-breakpoint
ALTER TABLE "pharmacies" ADD COLUMN "brand_id" uuid;--> statement-breakpoint
ALTER TABLE "pharmacies" ADD CONSTRAINT "pharmacies_brand_id_pharmacy_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."pharmacy_brands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- Backfill: derive a brand for every existing location. Mirrors
-- @rxsr/core derivePharmacyBrandName (strip trailing "#123", then a trailing
-- parenthetical, collapse whitespace; fall back to the raw name when the
-- stripped form is shorter than 2 characters).
INSERT INTO "pharmacy_brands" ("name", "normalized_name")
SELECT DISTINCT ON (norm) disp, norm
FROM (
  SELECT
    CASE WHEN length(stripped) >= 2 THEN stripped ELSE btrim(name) END AS disp,
    lower(CASE WHEN length(stripped) >= 2 THEN stripped ELSE btrim(name) END) AS norm
  FROM (
    SELECT
      name,
      btrim(regexp_replace(regexp_replace(regexp_replace(name, '\s*#\s*\d+\s*$', ''), '\s*\([^)]*\)\s*$', ''), '\s+', ' ', 'g')) AS stripped
    FROM "pharmacies"
  ) raw
) derived
WHERE norm <> ''
ORDER BY norm, disp
ON CONFLICT ("normalized_name") DO NOTHING;--> statement-breakpoint
UPDATE "pharmacies" p
SET "brand_id" = b."id"
FROM "pharmacy_brands" b
WHERE p."brand_id" IS NULL
  AND b."normalized_name" = lower(
    CASE
      WHEN length(btrim(regexp_replace(regexp_replace(regexp_replace(p.name, '\s*#\s*\d+\s*$', ''), '\s*\([^)]*\)\s*$', ''), '\s+', ' ', 'g'))) >= 2
      THEN btrim(regexp_replace(regexp_replace(regexp_replace(p.name, '\s*#\s*\d+\s*$', ''), '\s*\([^)]*\)\s*$', ''), '\s+', ' ', 'g'))
      ELSE btrim(p.name)
    END
  );
