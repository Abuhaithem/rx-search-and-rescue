/**
 * .docx generation from a ReportModel. Pure function of its input — no data
 * access, no AI, no clock reads (dates come in on the model). Implemented by
 * the backend agent; contract: generateReportDocx(model) → Buffer.
 */
import type { ReportModel } from "@rxsr/core/report-model";

export async function generateReportDocx(model: ReportModel): Promise<Buffer> {
  const { renderDocx } = await import("./docx-renderer");
  return renderDocx(model);
}

export type { ReportModel };
