import { and, desc, eq, ilike, sql } from "drizzle-orm";
import { analyses, analysisPlans, clients, getDb, profiles } from "@rxsr/db";
import type { AnalysisStatus } from "@rxsr/core";

export interface WorkQueueFilters {
  status?: AnalysisStatus;
  planYear?: number;
  search?: string;
}

export interface WorkQueueRow {
  analysisId: string;
  clientName: string;
  agentName: string | null;
  planYear: number;
  plansCompared: number;
  status: AnalysisStatus;
  updatedAt: Date;
}

export async function getWorkQueue(filters: WorkQueueFilters = {}): Promise<WorkQueueRow[]> {
  const db = getDb();
  const conditions = [];
  if (filters.status) conditions.push(eq(analyses.status, filters.status));
  if (filters.planYear != null) conditions.push(eq(analyses.planYear, filters.planYear));
  if (filters.search) conditions.push(ilike(clients.fullName, `%${filters.search}%`));

  return db
    .select({
      analysisId: analyses.id,
      clientName: clients.fullName,
      agentName: profiles.fullName,
      planYear: analyses.planYear,
      plansCompared: sql<number>`(select count(*)::int from ${analysisPlans} where ${analysisPlans.analysisId} = ${analyses.id})`,
      status: analyses.status,
      updatedAt: analyses.updatedAt,
    })
    .from(analyses)
    .innerJoin(clients, eq(analyses.clientId, clients.id))
    .leftJoin(profiles, eq(analyses.assignedTo, profiles.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(analyses.updatedAt));
}
