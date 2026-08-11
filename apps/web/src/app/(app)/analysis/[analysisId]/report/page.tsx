import { notFound } from "next/navigation";
import { getComparison } from "@/server/queries/comparison";
import { getReportModel } from "@/server/queries/report";
import { ReportEditor } from "./_components/report-editor";

export const dynamic = "force-dynamic";

export default async function ReportPage({
  params,
}: {
  params: Promise<{ analysisId: string }>;
}) {
  const { analysisId } = await params;
  const [model, comparison] = await Promise.all([
    getReportModel(analysisId),
    getComparison(analysisId),
  ]);
  if (!model || !comparison) notFound();

  return (
    <ReportEditor
      analysisId={analysisId}
      clientId={comparison.client.id}
      model={model}
      status={comparison.analysis.status}
      pdfReady={comparison.analysis.reportPdfPath !== null}
    />
  );
}
