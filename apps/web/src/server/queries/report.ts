import { and, desc, eq } from "drizzle-orm";
import { getDb, ingestionJobs } from "@rxsr/db";
import type { ReportModel } from "@rxsr/core/report-model";
import { buildReportModel } from "../report/build-model";

/** Generated model with stored agent overrides applied — what the report editor renders. */
export async function getReportModel(analysisId: string): Promise<ReportModel | null> {
  return buildReportModel(analysisId);
}

export interface ReportPdfJobStatus {
  status: string;
  error: string | null;
}

/** Latest docx→PDF conversion job for this analysis — powers the PDF link state. */
export async function getReportPdfJob(analysisId: string): Promise<ReportPdfJobStatus | null> {
  const db = getDb();
  const [job] = await db
    .select({ status: ingestionJobs.status, error: ingestionJobs.error })
    .from(ingestionJobs)
    .where(and(eq(ingestionJobs.kind, "report_pdf"), eq(ingestionJobs.targetId, analysisId)))
    .orderBy(desc(ingestionJobs.createdAt))
    .limit(1);
  return job ?? null;
}
