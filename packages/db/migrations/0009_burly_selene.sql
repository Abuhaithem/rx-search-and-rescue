CREATE TABLE "carrier_pharmacy_networks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"carrier_id" uuid NOT NULL,
	"pharmacy_id" uuid NOT NULL,
	"status" "network_status" NOT NULL,
	"source" "network_source" NOT NULL,
	"staged" boolean DEFAULT false NOT NULL,
	"verified_by" uuid,
	"verified_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "carrier_pharmacy_networks" ADD CONSTRAINT "carrier_pharmacy_networks_carrier_id_carriers_id_fk" FOREIGN KEY ("carrier_id") REFERENCES "public"."carriers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "carrier_pharmacy_networks" ADD CONSTRAINT "carrier_pharmacy_networks_pharmacy_id_pharmacies_id_fk" FOREIGN KEY ("pharmacy_id") REFERENCES "public"."pharmacies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "carrier_pharmacy_networks" ADD CONSTRAINT "carrier_pharmacy_networks_verified_by_profiles_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "carrier_pharmacy_networks_uq" ON "carrier_pharmacy_networks" USING btree ("carrier_id","pharmacy_id");--> statement-breakpoint
-- Data migration: directory/workbook rows were carrier-wide truths copied per
-- plan — collapse them up to the carrier (latest verification wins), then
-- drop the per-plan copies. Agent overrides and CMS per-plan data stay as the
-- plan-level exception layer.
INSERT INTO "carrier_pharmacy_networks" ("carrier_id", "pharmacy_id", "status", "source", "staged", "verified_by", "verified_at")
SELECT DISTINCT ON (p."carrier_id", n."pharmacy_id")
  p."carrier_id", n."pharmacy_id", n."status", n."source", n."staged", n."verified_by", n."verified_at"
FROM "plan_pharmacy_networks" n
JOIN "plans" p ON p."id" = n."plan_id"
WHERE n."source" IN ('directory', 'xlsx')
ORDER BY p."carrier_id", n."pharmacy_id", n."verified_at" DESC NULLS LAST
ON CONFLICT ("carrier_id", "pharmacy_id") DO NOTHING;--> statement-breakpoint
DELETE FROM "plan_pharmacy_networks" WHERE "source" IN ('directory', 'xlsx');
