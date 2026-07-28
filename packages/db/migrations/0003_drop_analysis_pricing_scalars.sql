ALTER TABLE "analyses" DROP CONSTRAINT "analyses_pricing_pharmacy_id_pharmacies_id_fk";
--> statement-breakpoint
ALTER TABLE "analyses" DROP COLUMN "pricing_pharmacy_id";--> statement-breakpoint
ALTER TABLE "analyses" DROP COLUMN "pricing_channel_override";