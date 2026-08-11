import Link from "next/link";
import { Building2, CircleCheck, Pencil, Plus, TriangleAlert } from "lucide-react";
import { getCarrierCatalog, getPlanYears } from "@/server/queries/carriers";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/domain/empty-state";
import { PageHeader } from "@/components/domain/page-header";
import { CarrierLogo } from "@/components/domain/carrier-logo";
import { formatUsd } from "@/components/domain/format";
import { cn } from "@/lib/utils";
import { getLatestDirectoryJob, searchPharmaciesByZip } from "../_lib/pharmacies";
import { RefreshPoller } from "../formularies/_components/refresh-poller";
import { CarrierDialog } from "./_components/carrier-dialog";
import { DeleteFormularyButton } from "./_components/delete-formulary-button";
import { CarrierNetworkSection } from "./_components/carrier-network-section";
import { WorkbookDialog } from "./_components/workbook-dialog";
import { YearSwitcher } from "./_components/year-switcher";

export const dynamic = "force-dynamic";

interface CarriersPageProps {
  searchParams: Promise<{ year?: string; carrier?: string; zip?: string }>;
}

export default async function CarriersPage({ searchParams }: CarriersPageProps) {
  const params = await searchParams;
  const fallbackYear = new Date().getFullYear();
  const year = Number(params.year) || fallbackYear;
  const [years, catalog] = await Promise.all([
    getPlanYears(fallbackYear, { includePlanning: true }),
    getCarrierCatalog(year),
  ]);
  const selected =
    catalog.find((c) => c.id === params.carrier) ?? catalog[0] ?? null;
  const zip = /^\d{5}$/.test(params.zip ?? "") ? params.zip! : null;
  const [pharmacyResults, directoryJob] = await Promise.all([
    selected && zip ? searchPharmaciesByZip(zip, selected.id, year) : Promise.resolve([]),
    selected ? getLatestDirectoryJob(selected.id) : Promise.resolve(null),
  ]);
  const directoryRunning =
    directoryJob?.status === "running" || directoryJob?.status === "queued";

  return (
    <div className="space-y-6">
      <RefreshPoller active={directoryRunning} />
      <PageHeader
        title="Carriers"
        description={`Everything loaded for plan year ${year}: each carrier's formularies, plans, and what still needs attention.`}
        actions={
          <>
            <YearSwitcher years={years} value={year} basePath="/admin/carriers" allowCreate />
            <CarrierDialog
              trigger={
                <Button>
                  <Plus className="size-4" /> New carrier
                </Button>
              }
            />
          </>
        }
      />

      {catalog.length === 0 ? (
        <EmptyState
          icon={<Building2 />}
          title="No carriers yet"
          description="Create the carriers you sell first — formularies and plans hang off them."
        />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[300px_minmax(0,1fr)]">
          <Card className="self-start">
            <CardContent className="p-2">
              <ul className="space-y-0.5">
                {catalog.map((carrier) => {
                  const isSelected = carrier.id === selected?.id;
                  const attention =
                    carrier.formularies.length === 0 ||
                    carrier.plans.length === 0 ||
                    carrier.plans.some((p) => !p.tierCostsComplete);
                  return (
                    <li key={carrier.id}>
                      <Link
                        href={`/admin/carriers?year=${year}&carrier=${carrier.id}`}
                        className={cn(
                          "flex items-center justify-between gap-2 rounded-md px-3 py-2 transition-colors",
                          isSelected
                            ? "bg-deepwater text-white"
                            : "hover:bg-fog text-deepwater",
                        )}
                      >
                        <CarrierLogo name={carrier.name} logoUrl={carrier.logoUrl} size={28} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold">
                            {carrier.name}
                          </span>
                          <span
                            className={cn(
                              "text-data text-xs",
                              isSelected ? "text-white/70" : "text-steel",
                            )}
                          >
                            {carrier.plans.length} drug plan
                            {carrier.plans.length === 1 ? "" : "s"}
                            {carrier.networkCount > 0
                              ? ` · ${carrier.networkCount.toLocaleString()} pharmacies`
                              : ""}
                          </span>
                        </span>
                        {attention ? (
                          <TriangleAlert
                            className={cn(
                              "size-4 shrink-0",
                              isSelected ? "text-white/80" : "text-restricted",
                            )}
                          />
                        ) : (
                          <CircleCheck
                            className={cn(
                              "size-4 shrink-0",
                              isSelected ? "text-white/80" : "text-covered",
                            )}
                          />
                        )}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </CardContent>
          </Card>

          {selected ? (
            <div className="space-y-6">
              <div className="flex items-center gap-3">
                <CarrierLogo name={selected.name} logoUrl={selected.logoUrl} size={44} />
                <h2 className="font-display text-xl font-extrabold text-deepwater">
                  {selected.name}
                </h2>
                <CarrierDialog
                  carrier={{ id: selected.id, name: selected.name, logoUrl: selected.logoUrl }}
                  trigger={
                    <Button variant="ghost" size="sm" aria-label="Rename carrier">
                      <Pencil className="size-4" />
                    </Button>
                  }
                />
                <div className="ml-auto">
                  <WorkbookDialog
                    carrierId={selected.id}
                    carrierName={selected.name}
                    planYear={year}
                  />
                </div>
              </div>

              <Card>
                <CardContent className="space-y-3 p-5">
                  <div className="flex items-center justify-between">
                    <p className="text-eyebrow">Drug plans — {year}</p>
                    <Link
                      href={`/admin/formularies/upload?year=${year}`}
                      className="text-sm font-semibold text-harbor hover:underline"
                    >
                      Add drug plan →
                    </Link>
                  </div>

                  {(() => {
                    const formularyById = new Map(selected.formularies.map((f) => [f.id, f]));
                    const linkedIds = new Set(
                      selected.plans.map((p) => p.formularyId).filter(Boolean),
                    );
                    // Uploads mid-wizard (or active but plan-less) surface as
                    // resumable setups; finished ones are represented by their plans.
                    const inSetup = selected.formularies.filter(
                      (f) =>
                        f.status !== "superseded" &&
                        (f.status !== "active" || !linkedIds.has(f.id)),
                    );

                    if (selected.plans.length === 0 && inSetup.length === 0) {
                      return (
                        <p className="text-sm text-steel">
                          No drug plans yet. A plan is created from its two documents — upload
                          the formulary list and its Summary of Benefits, and the plan lands
                          here priced and ready to review.
                        </p>
                      );
                    }

                    return (
                      <ul className="divide-y divide-mist/55">
                        {inSetup.map((formulary) => (
                          <li
                            key={formulary.id}
                            className="flex items-center justify-between gap-3 py-2.5"
                          >
                            <Link
                              href={`/admin/formularies/upload?formulary=${formulary.id}&step=2`}
                              className="min-w-0 truncate text-sm font-medium text-deepwater hover:underline"
                            >
                              {formulary.label} — resume setup →
                            </Link>
                            <span className="flex shrink-0 items-center gap-2">
                              {formulary.needsReview > 0 ? (
                                <span className="rounded-chip bg-restricted-soft px-2 py-0.5 font-mono text-[11px] font-semibold uppercase tracking-[0.1em] text-restricted">
                                  {formulary.needsReview} to review
                                </span>
                              ) : null}
                              {formulary.jobFailed ? (
                                <span
                                  title={formulary.jobError ?? undefined}
                                  className="rounded-chip bg-notcovered-soft px-2 py-0.5 font-mono text-[11px] font-semibold uppercase tracking-[0.1em] text-notcovered"
                                >
                                  Failed
                                </span>
                              ) : (
                                <span className="rounded-chip bg-restricted-soft px-2 py-0.5 font-mono text-[11px] font-semibold uppercase tracking-[0.1em] text-restricted">
                                  {formulary.status === "ingesting" ? "Reading" : "Setup"}
                                </span>
                              )}
                              <span className="text-data text-xs text-steel">
                                {formulary.totalEntries.toLocaleString()} drugs
                              </span>
                              <DeleteFormularyButton
                                formularyId={formulary.id}
                                label={formulary.label}
                              />
                            </span>
                          </li>
                        ))}

                        {selected.plans.map((plan) => {
                          const formulary = plan.formularyId
                            ? formularyById.get(plan.formularyId)
                            : undefined;
                          return (
                            <li
                              key={plan.id}
                              className="flex items-center justify-between gap-3 py-2.5"
                            >
                              <span className="min-w-0">
                                <Link
                                  href={`/admin/carriers/${selected.id}/plans/${plan.id}?year=${year}`}
                                  className="block truncate text-sm font-medium text-deepwater hover:underline"
                                >
                                  {plan.name}
                                </Link>
                                <span className="text-data text-xs text-steel">
                                  {plan.contractPlanId ?? "—"}
                                  {plan.premiumCents !== null
                                    ? ` · ${formatUsd(plan.premiumCents)}/mo`
                                    : ""}
                                </span>
                              </span>
                              <span className="flex shrink-0 items-center gap-2">
                                {formulary ? (
                                  <span className="rounded-chip bg-covered-soft px-2 py-0.5 font-mono text-[11px] font-semibold uppercase tracking-[0.1em] text-covered">
                                    {formulary.totalEntries.toLocaleString()} drugs
                                  </span>
                                ) : (
                                  <span className="rounded-chip bg-restricted-soft px-2 py-0.5 font-mono text-[11px] font-semibold uppercase tracking-[0.1em] text-restricted">
                                    No drug list
                                  </span>
                                )}
                                <span
                                  className={cn(
                                    "rounded-chip px-2 py-0.5 font-mono text-[11px] font-semibold uppercase tracking-[0.1em]",
                                    plan.tierCostsComplete
                                      ? "bg-covered-soft text-covered"
                                      : "bg-restricted-soft text-restricted",
                                  )}
                                >
                                  {plan.tierCostsComplete ? "Costs ✓" : "Costs missing"}
                                </span>
                                <Link
                                  href={`/admin/carriers/${selected.id}/plans/${plan.id}?year=${year}`}
                                  className="rounded-chip bg-fog px-2 py-0.5 font-mono text-[11px] font-semibold uppercase tracking-[0.1em] text-harbor hover:bg-mist/60"
                                >
                                  Open →
                                </Link>
                              </span>
                            </li>
                          );
                        })}
                      </ul>
                    );
                  })()}
                </CardContent>
              </Card>

              <CarrierNetworkSection
                key={`network-${selected.id}`}
                carrierId={selected.id}
                year={year}
                networkCount={selected.networkCount}
                zip={zip}
                results={pharmacyResults}
                job={directoryJob}
              />

              <p className="text-xs text-steel">
                A drug plan is its formulary list + Summary of Benefits; the pharmacy network
                is uploaded once per carrier and shared by all its plans. Agents only see plans
                once costs are complete.
              </p>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
