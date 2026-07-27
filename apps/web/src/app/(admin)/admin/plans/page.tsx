import Link from "next/link";
import { Check, Layers } from "lucide-react";
import { EmptyState } from "@/components/domain/empty-state";
import { PageHeader } from "@/components/domain/page-header";
import { RestrictionChip } from "@/components/domain/restriction-chip";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { getPlanCatalog } from "@/server/queries/plans";
import { listCarriers } from "../_lib/carriers";
import { getLatestCmsImport } from "../_lib/cms-import";
import { searchPharmaciesByZip } from "../_lib/pharmacies";
import { RefreshPoller } from "../formularies/_components/refresh-poller";
import { AddPlanDialog } from "./_components/add-plan-dialog";
import { ImportCmsDialog } from "./_components/import-cms-dialog";
import { PharmacyNetworkSection } from "./_components/pharmacy-network-section";
import { PlanEditor } from "./_components/plan-editor";

interface PageProps {
  searchParams: Promise<{ year?: string; plan?: string; pzip?: string }>;
}

export default async function PlanCatalogPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const year = Number.parseInt(params.year ?? "", 10) || new Date().getFullYear();

  const [catalog, carrierOptions, cmsImport] = await Promise.all([
    getPlanCatalog(year),
    listCarriers(),
    getLatestCmsImport(),
  ]);
  const selected = catalog.find((row) => row.plan.id === params.plan) ?? catalog[0] ?? null;
  const zip = /^\d{5}$/.test(params.pzip ?? "") ? params.pzip! : null;
  const pharmacyResults =
    selected && zip ? await searchPharmaciesByZip(zip, selected.plan.id) : [];

  return (
    <div className="space-y-8">
      <PageHeader
        title={`Plan Catalog — ${year}`}
        actions={
          <div className="flex items-center gap-2">
            <ImportCmsDialog defaultYear={year} />
            <AddPlanDialog carriers={carrierOptions} year={year} />
          </div>
        }
      />

      <RefreshPoller active={cmsImport?.running ?? false} />
      {cmsImport?.running ? (
        <p className="text-sm text-steel">
          CMS import running — {cmsImport.message ?? "starting…"}
        </p>
      ) : null}

      {catalog.length === 0 ? (
        <EmptyState
          icon={<Layers />}
          title={`No plans for ${year} yet`}
          description="Plans are created automatically when their formulary is uploaded — the admin never creates plans by hand after an upload. Upload a formulary first, then finish each plan's costs here."
        />
      ) : (
        <div className="grid items-start gap-6 lg:grid-cols-[300px_minmax(0,1fr)]">
          {/* Left pane: catalog list with completeness at a glance. */}
          <Card>
            <CardHeader className="p-4 pb-2">
              <p className="text-eyebrow">
                Plan ({catalog.length} in catalog)
              </p>
            </CardHeader>
            <CardContent className="p-2 pt-0">
              <ul className="flex flex-col">
                {catalog.map((row) => (
                  <li key={row.plan.id}>
                    <Link
                      href={`/admin/plans?year=${year}&plan=${row.plan.id}`}
                      aria-current={selected?.plan.id === row.plan.id ? "page" : undefined}
                      className={cn(
                        "flex items-center justify-between gap-2 rounded-md px-3 py-2.5 text-sm font-semibold text-deepwater transition-colors hover:bg-fog",
                        selected?.plan.id === row.plan.id && "bg-fog",
                      )}
                    >
                      <span className="truncate">{row.plan.name}</span>
                      {row.tierCostsComplete ? (
                        <span
                          className="inline-flex shrink-0 items-center rounded-chip bg-covered-soft px-1.5 py-0.5 text-covered"
                          title="Tier costs complete"
                        >
                          <Check className="size-3" strokeWidth={3} />
                        </span>
                      ) : (
                        <RestrictionChip kind="custom" label="costs missing" className="shrink-0" />
                      )}
                    </Link>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          {/* Right pane: the selected plan's money numbers + pharmacy network. */}
          {selected ? (
            <div className="space-y-6">
              <PlanEditor key={selected.plan.id} row={selected} />
              <PharmacyNetworkSection
                key={`network-${selected.plan.id}`}
                planId={selected.plan.id}
                year={year}
                directoryAttached={selected.plan.pharmacyDirectoryPath != null}
                zip={zip}
                results={pharmacyResults}
              />
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
