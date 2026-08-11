import { and, count, desc, eq, ilike, or } from "drizzle-orm";
import { formularyEntries, getDb, plans } from "@rxsr/db";
import { createSignedDownloadUrl } from "../storage";
import { isTierCostsComplete, type PlanCatalogRow } from "./plans";

export interface PlanWorkspace {
  catalogRow: PlanCatalogRow;
  carrier: { id: string; name: string; logoUrl: string | null };
  formulary: {
    id: string;
    label: string;
    status: string;
    totalEntries: number;
    needsReview: number;
  } | null;
}

/** Everything the per-plan workspace screen needs, in the PlanEditor's shape. */
export async function getPlanWorkspace(planId: string): Promise<PlanWorkspace | null> {
  const db = getDb();
  const plan = await db.query.plans.findFirst({
    where: eq(plans.id, planId),
    with: {
      carrier: true,
      formulary: true,
      tierCosts: { where: (t, { eq: eqOp }) => eqOp(t.staged, false) },
      serviceAreas: true,
    },
  });
  if (!plan) return null;

  const { carrier, formulary, tierCosts, serviceAreas, ...planColumns } = plan;
  return {
    catalogRow: {
      plan: planColumns,
      carrierName: carrier.name,
      formularyLabel: formulary?.label ?? null,
      formularyStatus: formulary?.status ?? null,
      tierCostsComplete: isTierCostsComplete(tierCosts),
      tierCostCount: tierCosts.length,
      serviceAreaCount: serviceAreas.length,
      tierCosts: tierCosts.map((tc) => ({
        channel: tc.channel,
        tier: tc.tier,
        daysSupply: tc.daysSupply,
        copayCents: tc.copayCents,
        coinsurancePct: tc.coinsurancePct == null ? null : Number(tc.coinsurancePct),
        sourceNote: tc.sourceNote,
      })),
      serviceAreas: serviceAreas.map((a) => ({ state: a.state, county: a.county })),
    },
    carrier: {
      id: carrier.id,
      name: carrier.name,
      logoUrl: carrier.logoPath
        ? await createSignedDownloadUrl(carrier.logoPath).catch(() => null)
        : null,
    },
    formulary: formulary
      ? {
          id: formulary.id,
          label: formulary.label,
          status: formulary.status,
          totalEntries: formulary.stats?.totalEntries ?? 0,
          needsReview: formulary.stats?.needsReview ?? 0,
        }
      : null,
  };
}

export interface FormularyEntryRow {
  id: string;
  rawDrugName: string;
  normalizedName: string | null;
  tier: number;
  rawRequirementsText: string | null;
  isBrand: boolean;
  needsReview: boolean;
  sourcePage: number;
}

export interface FormularyEntriesPage {
  rows: FormularyEntryRow[];
  total: number;
  page: number;
  pageCount: number;
}

export const ENTRIES_PAGE_SIZE = 50;

/** One page of a plan's drug list — searchable by name, filterable to flagged. */
export async function getFormularyEntriesPage(
  formularyId: string,
  options: { q?: string; page?: number; reviewOnly?: boolean } = {},
): Promise<FormularyEntriesPage> {
  const db = getDb();
  const page = Math.max(1, options.page ?? 1);
  const q = options.q?.trim() ?? "";

  const filters = [eq(formularyEntries.formularyId, formularyId)];
  if (q !== "") {
    const pattern = `%${q}%`;
    filters.push(
      or(
        ilike(formularyEntries.rawDrugName, pattern),
        ilike(formularyEntries.normalizedName, pattern),
      )!,
    );
  }
  if (options.reviewOnly) filters.push(eq(formularyEntries.needsReview, true));
  const where = and(...filters);

  const [rows, [totalRow]] = await Promise.all([
    db
      .select({
        id: formularyEntries.id,
        rawDrugName: formularyEntries.rawDrugName,
        normalizedName: formularyEntries.normalizedName,
        tier: formularyEntries.tier,
        rawRequirementsText: formularyEntries.rawRequirementsText,
        isBrand: formularyEntries.isBrand,
        needsReview: formularyEntries.needsReview,
        sourcePage: formularyEntries.sourcePage,
      })
      .from(formularyEntries)
      .where(where)
      .orderBy(
        desc(formularyEntries.needsReview),
        formularyEntries.rawDrugName,
        formularyEntries.sourcePage,
      )
      .limit(ENTRIES_PAGE_SIZE)
      .offset((page - 1) * ENTRIES_PAGE_SIZE),
    db.select({ value: count() }).from(formularyEntries).where(where),
  ]);

  const total = totalRow?.value ?? 0;
  return {
    rows,
    total,
    page,
    pageCount: Math.max(1, Math.ceil(total / ENTRIES_PAGE_SIZE)),
  };
}
