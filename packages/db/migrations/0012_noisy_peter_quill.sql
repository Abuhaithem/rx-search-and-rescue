DROP INDEX "plan_tier_costs_uq";--> statement-breakpoint
CREATE UNIQUE INDEX "plan_tier_costs_uq" ON "plan_tier_costs" USING btree ("plan_id","channel","tier","days_supply","staged");