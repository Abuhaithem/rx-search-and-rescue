import { notFound } from "next/navigation";
import { getComparison } from "@/server/queries/comparison";
import { getReportModel, getReportPdfJob } from "@/server/queries/report";
import { ReportEditor } from "./_components/report-editor";

export const dynamic = "force-dynamic";

export default async function ReportPage({
  params,
}: {
  params: Promise<{ analysisId: string }>;
}) {
  const { analysisId } = await params;
  const [model, comparison, pdfJob] = await Promise.all([
    getReportModel(analysisId),
    getComparison(analysisId),
    getReportPdfJob(analysisId),
  ]);
  if (!model || !comparison) notFound();

  const pdfState = comparison.analysis.reportPdfPath
    ? ("ready" as const)
    : pdfJob?.status === "failed"
      ? ("failed" as const)
      : ("working" as const);

  return (
    <ReportEditor
      analysisId={analysisId}
      clientId={comparison.client.id}
      model={model}
      status={comparison.analysis.status}
      pdfState={pdfState}
      pdfError={pdfJob?.error ?? null}
    />
  );
}
