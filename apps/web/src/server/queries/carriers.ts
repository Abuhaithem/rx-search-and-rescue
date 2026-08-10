import { desc } from "drizzle-orm";
import { formularies, getDb, plans } from "@rxsr/db";
import { isTierCostsComplete } from "./plans";

export type FormularyStatus = (typeof formularies.$inferSelect)["status"];

export interface CarrierPlanSummary {
  id: string;
  name: string;
  contractPlanId: string | null;
  premiumCents: number | null;
  curated: boolean;
  tierCostsComplete: boolean;
  pharmacyDirectoryAttached: boolean;
  serviceAreaCount: number;
}

export interface CarrierFormularySummary {
  id: string;
  label: string;
  status: FormularyStatus;
  totalEntries: number;
  needsReview: number;
}

export interface CarrierCatalogRow {
  id: string;
  name: string;
  slug: string;
  plans: CarrierPlanSummary[];
  formularies: CarrierFormularySummary[];
}

/**
 * Every carrier with its plans + formularies for one plan year. Carriers with
 * nothing loaded for the year still appear — that absence is what the admin
 * screen needs to show.
 */
export async function getCarrierCatalog(planYear: number): Promise<CarrierCatalogRow[]> {
  const rows = await getDb().query.carriers.findMany({
    orderBy: (c, { asc: ascOp }) => [ascOp(c.name)],
    with: {
      plans: {
        where: (p, { eq }) => eq(p.planYear, planYear),
        orderBy: (p, { asc: ascOp }) => [ascOp(p.name)],
        with: {
          tierCosts: { columns: { channel: true, tier: true } },
          serviceAreas: { columns: { id: true } },
        },
      },
      formularies: {
        where: (f, { eq }) => eq(f.planYear, planYear),
        orderBy: (f, { desc: descOp }) => [descOp(f.createdAt)],
      },
    },
  });

  return rows.map((carrier) => ({
    id: carrier.id,
    name: carrier.name,
    slug: carrier.slug,
    plans: carrier.plans.map((plan) => ({
      id: plan.id,
      name: plan.name,
      contractPlanId: plan.contractPlanId,
      premiumCents: plan.premiumCents,
      curated: plan.curated,
      tierCostsComplete: isTierCostsComplete(plan.tierCosts),
      pharmacyDirectoryAttached: plan.pharmacyDirectoryPath !== null,
      serviceAreaCount: plan.serviceAreas.length,
    })),
    formularies: carrier.formularies.map((formulary) => ({
      id: formulary.id,
      label: formulary.label,
      status: formulary.status,
      totalEntries: formulary.stats?.totalEntries ?? 0,
      needsReview: formulary.stats?.needsReview ?? 0,
    })),
  }));
}

/**
 * Every plan year present in the DB (plans ∪ formularies), newest first.
 * The UI never hardcodes year lists; fallbackYear (usually the current year)
 * is included so a fresh install still has something to select.
 */
export async function getPlanYears(fallbackYear: number): Promise<number[]> {
  const db = getDb();
  const [planYears, formularyYears] = await Promise.all([
    db.selectDistinct({ year: plans.planYear }).from(plans).orderBy(desc(plans.planYear)),
    db
      .selectDistinct({ year: formularies.planYear })
      .from(formularies)
      .orderBy(desc(formularies.planYear)),
  ]);
  const years = new Set<number>([
    fallbackYear,
    ...planYears.map((r) => r.year),
    ...formularyYears.map((r) => r.year),
  ]);
  return [...years].sort((a, b) => b - a);
}
