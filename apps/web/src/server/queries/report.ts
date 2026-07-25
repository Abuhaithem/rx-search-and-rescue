import type { ReportModel } from "@rxsr/core/report-model";
import { buildReportModel } from "../report/build-model";

/** Generated model with stored agent overrides applied — what the report editor renders. */
export async function getReportModel(analysisId: string): Promise<ReportModel | null> {
  return buildReportModel(analysisId);
}
