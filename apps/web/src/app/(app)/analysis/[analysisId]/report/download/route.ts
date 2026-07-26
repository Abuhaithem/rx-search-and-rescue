import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { analyses, getDb } from "@rxsr/db";
import { getProfile } from "@/server/queries/profile";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const DOCX_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ analysisId: string }> },
) {
  const { analysisId } = await params;

  const profile = await getProfile();
  if (!profile) return new NextResponse("Unauthorized", { status: 401 });

  const analysis = await getDb().query.analyses.findFirst({
    where: eq(analyses.id, analysisId),
    with: { client: { columns: { fullName: true } } },
  });
  if (!analysis?.reportPath) {
    return new NextResponse("Report not generated yet", { status: 404 });
  }

  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase.storage.from("documents").download(analysis.reportPath);
  if (error || !data) {
    return new NextResponse("Report file unavailable", { status: 404 });
  }

  const safeName = analysis.client.fullName.replace(/[^\w .,'-]/g, "").trim() || "Client";
  const buffer = await data.arrayBuffer();
  return new NextResponse(buffer, {
    headers: {
      "Content-Type": DOCX_CONTENT_TYPE,
      "Content-Disposition": `attachment; filename="${safeName} - Medicare Analysis.docx"`,
      "Content-Length": String(buffer.byteLength),
    },
  });
}
