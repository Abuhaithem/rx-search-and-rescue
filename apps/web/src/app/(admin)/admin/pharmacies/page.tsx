import { asc, desc, eq, sql } from "drizzle-orm";
import { getDb, ingestionJobs, pharmacies } from "@rxsr/db";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/domain/page-header";
import { RefreshPoller } from "../formularies/_components/refresh-poller";
import { PastePharmacyList } from "./_components/paste-pharmacy-list";
import { PharmacyTable, type PharmacyTableRow } from "./_components/pharmacy-table";
import { RosterUpload } from "./_components/roster-upload";

export const dynamic = "force-dynamic";

export default async function PharmaciesAdminPage() {
  const db = getDb();
  const counts = await db
    .select({
      state: pharmacies.state,
      count: sql<number>`count(*)::int`,
    })
    .from(pharmacies)
    .groupBy(pharmacies.state)
    .orderBy(sql`count(*) desc`);

  const [rosterJob] = await db
    .select({
      status: ingestionJobs.status,
      message: sql<string | null>`${ingestionJobs.progress} ->> 'message'`,
      error: ingestionJobs.error,
    })
    .from(ingestionJobs)
    .where(eq(ingestionJobs.kind, "pharmacy_roster"))
    .orderBy(desc(ingestionJobs.createdAt))
    .limit(1);
  const rosterRunning = rosterJob?.status === "queued" || rosterJob?.status === "running";

  const listRows = await db.query.pharmacies.findMany({
    columns: {
      id: true,
      name: true,
      address1: true,
      city: true,
      state: true,
      zip: true,
      source: true,
    },
    with: { brand: { columns: { name: true } } },
    orderBy: (p) => [asc(p.name)],
    limit: 3000,
  });
  const tableRows: PharmacyTableRow[] = listRows.map((row) => ({
    id: row.id,
    name: row.name,
    brandName: row.brand?.name ?? null,
    address1: row.address1,
    city: row.city,
    state: row.state,
    zip: row.zip,
    source: row.source,
  }));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Pharmacies"
        description="The master pharmacy list. Every carrier network, pharmacy picker, and intake match resolves against these rows — one list, referenced everywhere."
      />

      <section className="flex flex-wrap gap-3">
        {counts.length === 0 ? (
          <p className="text-sm text-steel">
            No pharmacies on file yet — paste your first list below.
          </p>
        ) : (
          counts.map((row) => (
            <Card key={row.state ?? "none"}>
              <CardContent className="space-y-0.5 px-5 py-3">
                <p className="text-eyebrow">{row.state ?? "No state"}</p>
                <p className="text-data text-xl font-semibold text-deepwater">
                  {row.count.toLocaleString()}
                </p>
              </CardContent>
            </Card>
          ))
        )}
      </section>

      <Card>
        <CardContent className="space-y-3 p-6">
          <RefreshPoller active={rosterRunning} />
          <RosterUpload />
          {rosterJob ? (
            <p
              className={`rounded-card px-4 py-2.5 text-sm ${
                rosterJob.status === "failed"
                  ? "bg-notcovered-soft text-notcovered"
                  : "bg-fog text-steel"
              }`}
            >
              {rosterJob.status === "failed"
                ? `Roster import failed: ${rosterJob.error ?? "unknown error"}`
                : rosterRunning
                  ? `${rosterJob.message ?? "Processing roster…"} — this page refreshes itself.`
                  : (rosterJob.message ?? "Last roster import finished.")}
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-6">
          <PastePharmacyList />
        </CardContent>
      </Card>

      <PharmacyTable rows={tableRows} />
    </div>
  );
}
