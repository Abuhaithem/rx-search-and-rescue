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
import { searchPharmaciesByZip } from "../_lib/pharmacies";
import { CarrierDialog } from "./_components/carrier-dialog";
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
  const pharmacyResults =
    selected && zip ? await searchPharmaciesByZip(zip, selected.id, year) : [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Carriers"
        description={`Everything loaded for plan year ${year}: each carrier's formularies, plans, and what still needs attention.`}
        actions={
          <>
            <YearSwitcher years={years} value={year} basePath="/admin/carriers" />
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
                            {carrier.plans.length} plan{carrier.plans.length === 1 ? "" : "s"} ·{" "}
                            {carrier.formularies.length} formular
                            {carrier.formularies.length === 1 ? "y" : "ies"}
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
                    <p className="text-eyebrow">Formularies — {year}</p>
                    <Link
                      href={`/admin/formularies/upload?year=${year}`}
                      className="text-sm font-semibold text-harbor hover:underline"
                    >
                      {selected.formularies.length === 0 ? "Load formulary →" : "Load another →"}
                    </Link>
                  </div>
                  {selected.formularies.length === 0 ? (
                    <p className="text-sm text-steel">
                      <span className="font-semibold text-deepwater">Step 1:</span> upload this
                      carrier&apos;s formulary PDF. Plans can share one document — upload it once.
                    </p>
                  ) : (
                    <ul className="divide-y divide-mist/55">
                      {selected.formularies.map((formulary) => (
                        <li key={formulary.id} className="flex items-center justify-between gap-3 py-2.5">
                          {formulary.status === "active" ? (
                            <span className="min-w-0 truncate text-sm font-medium text-deepwater">
                              {formulary.label}
                            </span>
                          ) : (
                            <Link
                              href={`/admin/formularies/upload?formulary=${formulary.id}&step=2`}
                              className="min-w-0 truncate text-sm font-medium text-deepwater hover:underline"
                            >
                              {formulary.label} — resume setup →
                            </Link>
                          )}
                          <span className="flex shrink-0 items-center gap-2">
                            {formulary.needsReview > 0 ? (
                              <span className="rounded-chip bg-restricted-soft px-2 py-0.5 font-mono text-[11px] font-semibold uppercase tracking-[0.1em] text-restricted">
                                {formulary.needsReview} to review
                              </span>
                            ) : null}
                            <span
                              className={cn(
                                "rounded-chip px-2 py-0.5 font-mono text-[11px] font-semibold uppercase tracking-[0.1em]",
                                formulary.status === "active"
                                  ? "bg-covered-soft text-covered"
                                  : formulary.status === "superseded"
                                    ? "bg-fog text-steel"
                                    : "bg-restricted-soft text-restricted",
                              )}
                            >
                              {formulary.status === "qa"
                                ? "QA"
                                : formulary.status === "ingesting"
                                  ? "Reading"
                                  : formulary.status}
                            </span>
                            <span className="text-data text-xs text-steel">
                              {formulary.totalEntries.toLocaleString()} entries
                            </span>
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardContent className="space-y-3 p-5">
                  <div className="flex items-center justify-between">
                    <p className="text-eyebrow">Plans — {year}</p>
                    <Link
                      href={`/admin/plans?year=${year}`}
                      className="text-sm font-semibold text-harbor hover:underline"
                    >
                      {selected.plans.length === 0 ? "Add plans →" : "Manage →"}
                    </Link>
                  </div>
                  {selected.plans.length === 0 ? (
                    <p className="text-sm text-steel">
                      <span className="font-semibold text-deepwater">Step 2:</span> add this
                      carrier&apos;s plans, then enter each plan&apos;s Summary of Benefits tier
                      costs and attach its pharmacy directory.
                    </p>
                  ) : (
                    <ul className="divide-y divide-mist/55">
                      {selected.plans.map((plan) => (
                        <li key={plan.id} className="flex items-center justify-between gap-3 py-2.5">
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
                      ))}
                    </ul>
                  )}
                </CardContent>
              </Card>

              <CarrierNetworkSection
                key={`network-${selected.id}`}
                carrierId={selected.id}
                year={year}
                networkCount={selected.networkCount}
                zip={zip}
                results={pharmacyResults}
              />

              <p className="text-xs text-steel">
                Load order per carrier: formulary PDF → plans (each with its Summary of Benefits)
                → ONE pharmacy directory for the whole carrier. Agents only see plans once costs
                are complete.
              </p>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
