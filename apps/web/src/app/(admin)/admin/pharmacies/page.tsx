import { sql } from "drizzle-orm";
import { getDb, pharmacies } from "@rxsr/db";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/domain/page-header";
import { PastePharmacyList } from "./_components/paste-pharmacy-list";

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
        <CardContent className="p-6">
          <PastePharmacyList />
        </CardContent>
      </Card>
    </div>
  );
}
