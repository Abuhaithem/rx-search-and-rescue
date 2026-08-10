import Link from "next/link";
import { Inbox } from "lucide-react";
import type { AnalysisStatus } from "@rxsr/core";
import { getPlanYears } from "@/server/queries/carriers";
import { getWorkQueue } from "@/server/queries/work-queue";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/domain/empty-state";
import { PageHeader } from "@/components/domain/page-header";
import { QueueFilters } from "./_components/queue-filters";
import { QueueTable, type QueueRow } from "./_components/queue-table";

export const dynamic = "force-dynamic";

const STATUSES: AnalysisStatus[] = ["new", "in_review", "approved", "delivered"];

const hrefForStatus = (analysisId: string, status: AnalysisStatus): string => {
  switch (status) {
    case "new":
      return `/analysis/${analysisId}/plans`;
    case "in_review":
      return `/analysis/${analysisId}`;
    case "approved":
    case "delivered":
      return `/analysis/${analysisId}/report`;
  }
};

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const search = typeof params.q === "string" ? params.q : "";
  const statusParam = typeof params.status === "string" ? params.status : "all";
  const status = STATUSES.find((s) => s === statusParam);
  const yearParam = typeof params.year === "string" ? Number(params.year) : NaN;
  const planYear = Number.isInteger(yearParam) ? yearParam : undefined;

  // Years come from the DB (plans ∪ formularies) — never synthesized.
  const [rows, years] = await Promise.all([
    getWorkQueue({
      status,
      planYear,
      search: search.trim() || undefined,
    }),
    getPlanYears(new Date().getFullYear()),
  ]);

  const queueRows: QueueRow[] = rows.map((row) => ({
    analysisId: row.analysisId,
    clientName: row.clientName,
    agentName: row.agentName,
    planYear: row.planYear,
    plansCompared: row.plansCompared,
    status: row.status,
    updatedAtIso: row.updatedAt.toISOString(),
    href: hrefForStatus(row.analysisId, row.status),
  }));

  const filtered = Boolean(search.trim() || status || planYear);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Work Queue"
        description="Every client analysis, from first intake to delivered report."
        actions={
          <Button asChild>
            <Link href="/intake/new">+ New Analysis</Link>
          </Button>
        }
      />

      <QueueFilters search={search} status={statusParam} year={planYear ?? null} years={years} />

      {queueRows.length > 0 ? (
        <Card className="overflow-hidden">
          <QueueTable rows={queueRows} />
        </Card>
      ) : (
        <EmptyState
          icon={<Inbox />}
          title={filtered ? "No matching reviews" : "No reviews yet"}
          description={
            filtered
              ? "Try clearing the search or filters to see the full queue."
              : "Upload a client's Rx Collect PDF to start the first analysis."
          }
          action={
            filtered ? undefined : (
              <Button asChild variant="secondary">
                <Link href="/intake/new">+ New Analysis</Link>
              </Button>
            )
          }
        />
      )}
    </div>
  );
}
