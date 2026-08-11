import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { analyses, getDb } from "@rxsr/db";
import { getProfile } from "@/server/queries/profile";
import { downloadObject } from "@/server/storage";

export const dynamic = "force-dynamic";

const DOCX_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ analysisId: string }> },
) {
  const { analysisId } = await params;
  const wantsPdf = new URL(request.url).searchParams.get("format") === "pdf";

  const profile = await getProfile();
  if (!profile) return new NextResponse("Unauthorized", { status: 401 });

  const analysis = await getDb().query.analyses.findFirst({
    where: eq(analyses.id, analysisId),
    with: { client: { columns: { fullName: true } } },
  });
  if (!analysis?.reportPath) {
    return new NextResponse("Report not generated yet", { status: 404 });
  }
  if (wantsPdf && !analysis.reportPdfPath) {
    return new NextResponse("PDF is still being prepared — try again in a moment", {
      status: 404,
    });
  }

  const bytes = await downloadObject(wantsPdf ? analysis.reportPdfPath! : analysis.reportPath);
  if (!bytes) {
    return new NextResponse("Report file unavailable", { status: 404 });
  }

  const safeName = analysis.client.fullName.replace(/[^\w .,'-]/g, "").trim() || "Client";
  const extension = wantsPdf ? "pdf" : "docx";
  return new NextResponse(Buffer.from(bytes), {
    headers: {
      "Content-Type": wantsPdf ? "application/pdf" : DOCX_CONTENT_TYPE,
      "Content-Disposition": `attachment; filename="${safeName} - Medicare Analysis.${extension}"`,
      "Content-Length": String(bytes.byteLength),
    },
  });
}
