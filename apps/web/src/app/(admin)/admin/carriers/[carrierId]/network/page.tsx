import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { carriers, getDb } from "@rxsr/db";
import { PageHeader } from "@/components/domain/page-header";
import { getCarrierNetworkRows } from "../../../_lib/pharmacies";
import { NetworkEditor } from "./_components/network-editor";

export const dynamic = "force-dynamic";

export default async function CarrierNetworkPage({
  params,
  searchParams,
}: {
  params: Promise<{ carrierId: string }>;
  searchParams: Promise<{ year?: string }>;
}) {
  const { carrierId } = await params;
  const { year: yearParam } = await searchParams;
  const year = Number.parseInt(yearParam ?? "", 10) || new Date().getFullYear();

  const db = getDb();
  const [carrier] = await db.select().from(carriers).where(eq(carriers.id, carrierId));
  if (!carrier) notFound();

  const rows = await getCarrierNetworkRows(carrierId, year);

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${carrier.name} — Pharmacy network ${year}`}
        description="Every pharmacy on this carrier's network for the year. Status changes here are agent-verified — they outrank every import, forever."
        backHref={`/admin/carriers?year=${year}&carrier=${carrierId}`}
      />
      <NetworkEditor carrierId={carrierId} planYear={year} rows={rows} />
    </div>
  );
}
