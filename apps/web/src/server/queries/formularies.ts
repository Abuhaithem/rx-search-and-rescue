import { and, count, eq, sql } from "drizzle-orm";
import { formularies, formularyEntries, getDb } from "@rxsr/db";

export type FormularyRow = typeof formularies.$inferSelect;

export interface FormularyListRow {
  id: string;
  carrierName: string;
  planYear: number;
  label: string;
  formularyCode: string | null;
  versionDate: string | null;
  status: FormularyRow["status"];
  stats: FormularyRow["stats"];
  planCount: number;
  entryCount: number;
  needsReviewCount: number;
  createdAt: Date;
  activatedAt: Date | null;
}

export async function getFormularies(planYear: number): Promise<FormularyListRow[]> {
  const db = getDb();
  const rows = await db.query.formularies.findMany({
    where: eq(formularies.planYear, planYear),
    with: { carrier: true, plans: { columns: { id: true } } },
    orderBy: (f, { desc }) => [desc(f.createdAt)],
  });

  const counts = await db
    .select({
      formularyId: formularyEntries.formularyId,
      entryCount: count(),
      needsReviewCount: sql<number>`count(*) filter (where ${formularyEntries.needsReview})::int`,
    })
    .from(formularyEntries)
    .groupBy(formularyEntries.formularyId);
  const countByFormulary = new Map(counts.map((c) => [c.formularyId, c]));

  return rows.map((f) => {
    const c = countByFormulary.get(f.id);
    return {
      id: f.id,
      carrierName: f.carrier.name,
      planYear: f.planYear,
      label: f.label,
      formularyCode: f.formularyCode,
      versionDate: f.versionDate,
      status: f.status,
      stats: f.stats,
      planCount: f.plans.length,
      entryCount: c?.entryCount ?? 0,
      needsReviewCount: c?.needsReviewCount ?? 0,
      createdAt: f.createdAt,
      activatedAt: f.activatedAt,
    };
  });
}

export interface FormularyReviewRow {
  id: string;
  rawDrugName: string;
  normalizedName: string | null;
  isBrand: boolean;
  tier: number;
  pa: boolean;
  st: boolean;
  qlQuantity: number | null;
  qlDays: number | null;
  extraFlags: string[];
  rawRequirementsText: string | null;
  therapeuticCategory: string | null;
  sourcePage: number;
  confidence: number | null;
}

export async function getFormularyReviewRows(formularyId: string): Promise<FormularyReviewRow[]> {
  const db = getDb();
  const rows = await db.query.formularyEntries.findMany({
    where: and(
      eq(formularyEntries.formularyId, formularyId),
      eq(formularyEntries.needsReview, true),
    ),
    orderBy: (e, { asc }) => [asc(e.sourcePage), asc(e.rawDrugName)],
  });
  return rows.map((e) => ({
    id: e.id,
    rawDrugName: e.rawDrugName,
    normalizedName: e.normalizedName,
    isBrand: e.isBrand,
    tier: e.tier,
    pa: e.pa,
    st: e.st,
    qlQuantity: e.qlQuantity,
    qlDays: e.qlDays,
    extraFlags: e.extraFlags,
    rawRequirementsText: e.rawRequirementsText,
    therapeuticCategory: e.therapeuticCategory,
    sourcePage: e.sourcePage,
    confidence: e.confidence == null ? null : Number(e.confidence),
  }));
}
