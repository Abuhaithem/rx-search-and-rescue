import { and, count, desc, eq } from "drizzle-orm";
import { carrierPharmacyNetworks, formularies, getDb, plans } from "@rxsr/db";
import { createSignedDownloadUrl } from "../storage";
import { isTierCostsComplete } from "./plans";

export type FormularyStatus = (typeof formularies.$inferSelect)["status"];

export interface CarrierPlanSummary {
  id: string;
  name: string;
  formularyId: string | null;
  contractPlanId: string | null;
  premiumCents: number | null;
  curated: boolean;
  tierCostsComplete: boolean;
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
  /** Presigned GET URL for the logo (1 h); null when no logo uploaded. */
  logoUrl: string | null;
  /** Live (unstaged) pharmacies on this carrier's network. */
  networkCount: number;
  plans: CarrierPlanSummary[];
  formularies: CarrierFormularySummary[];
}

/**
 * Every carrier with its plans + formularies for one plan year. Carriers with
 * nothing loaded for the year still appear — that absence is what the admin
 * screen needs to show.
 */
export async function getCarrierCatalog(planYear: number): Promise<CarrierCatalogRow[]> {
  const db = getDb();
  const networkCounts = await db
    .select({ carrierId: carrierPharmacyNetworks.carrierId, value: count() })
    .from(carrierPharmacyNetworks)
    .where(
      and(
        eq(carrierPharmacyNetworks.staged, false),
        eq(carrierPharmacyNetworks.planYear, planYear),
      ),
    )
    .groupBy(carrierPharmacyNetworks.carrierId);
  const networkByCarrier = new Map(networkCounts.map((r) => [r.carrierId, r.value]));

  const rows = await db.query.carriers.findMany({
    orderBy: (c, { asc: ascOp }) => [ascOp(c.name)],
    with: {
      plans: {
        where: (p, { eq }) => eq(p.planYear, planYear),
        orderBy: (p, { asc: ascOp }) => [ascOp(p.name)],
        with: {
          tierCosts: {
            columns: { channel: true, tier: true },
            where: (t, { eq }) => eq(t.staged, false),
          },
          serviceAreas: { columns: { id: true } },
        },
      },
      formularies: {
        where: (f, { eq }) => eq(f.planYear, planYear),
        orderBy: (f, { desc: descOp }) => [descOp(f.createdAt)],
      },
    },
  });

  return Promise.all(
    rows.map(async (carrier) => ({
      id: carrier.id,
      name: carrier.name,
      slug: carrier.slug,
      logoUrl: carrier.logoPath
        ? await createSignedDownloadUrl(carrier.logoPath).catch(() => null)
        : null,
      networkCount: networkByCarrier.get(carrier.id) ?? 0,
      plans: carrier.plans.map((plan) => ({
        id: plan.id,
        name: plan.name,
        formularyId: plan.formularyId,
        contractPlanId: plan.contractPlanId,
        premiumCents: plan.premiumCents,
        curated: plan.curated,
        tierCostsComplete: isTierCostsComplete(plan.tierCosts),
        serviceAreaCount: plan.serviceAreas.length,
      })),
      formularies: carrier.formularies.map((formulary) => ({
        id: formulary.id,
        label: formulary.label,
        status: formulary.status,
        totalEntries: formulary.stats?.totalEntries ?? 0,
        needsReview: formulary.stats?.needsReview ?? 0,
      })),
    })),
  );
}

/**
 * Every plan year present in the DB (plans ∪ formularies), newest first.
 * The UI never hardcodes year lists; fallbackYear (usually the current year)
 * is included so a fresh install still has something to select. Creation
 * screens pass includePlanning so the NEXT year is offered before any data
 * exists for it (AEP prep: 2027 plans load during fall 2026) — data filters
 * (dashboard) stay strictly DB-driven.
 */
export async function getPlanYears(
  fallbackYear: number,
  options: { includePlanning?: boolean } = {},
): Promise<number[]> {
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
    ...(options.includePlanning ? [fallbackYear + 1] : []),
    ...planYears.map((r) => r.year),
    ...formularyYears.map((r) => r.year),
  ]);
  return [...years].sort((a, b) => b - a);
}
