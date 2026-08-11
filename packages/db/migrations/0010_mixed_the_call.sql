DROP INDEX "carrier_pharmacy_networks_uq";--> statement-breakpoint
ALTER TABLE "carrier_pharmacy_networks" ADD COLUMN "plan_year" integer;--> statement-breakpoint
-- Backfill: existing rows came from a single-year deployment — attribute them
-- to the carrier's earliest plan year on file, else the current year.
UPDATE "carrier_pharmacy_networks" n
SET "plan_year" = COALESCE(
  (SELECT MIN(p."plan_year") FROM "plans" p WHERE p."carrier_id" = n."carrier_id"),
  EXTRACT(YEAR FROM CURRENT_DATE)::int
);--> statement-breakpoint
ALTER TABLE "carrier_pharmacy_networks" ALTER COLUMN "plan_year" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "carrier_pharmacy_networks_uq" ON "carrier_pharmacy_networks" USING btree ("carrier_id","plan_year","pharmacy_id");
