import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { MatchMethod } from "@rxsr/core";
import type { CellResult, PlanSummary } from "@rxsr/core/analysis";
import { getComparison, getComparablePharmacies } from "@/server/queries/comparison";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TBody, TCell, TH, THead, TRow } from "@/components/ui/table";
import { CoverageCell } from "@/components/domain/coverage-cell";
import { PageHeader } from "@/components/domain/page-header";
import { PlanSummaryCard } from "@/components/domain/plan-summary-card";
import { RestrictionChip } from "@/components/domain/restriction-chip";
import { CostMatrix } from "@/components/domain/cost-matrix";
import { WorkflowNav } from "@/components/domain/workflow-nav";
import { MailOrderToggle } from "./_components/mail-order-toggle";
import { PharmacyPicker } from "./_components/pharmacy-picker";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

const matchMethodLabels: Record<MatchMethod, string> = {
  exact_rxcui: "exact RXCUI match",
  ingredient_strength_form: "ingredient + strength + form",
  brand_generic_crosswalk: "brand/generic crosswalk",
  fuzzy_name: "fuzzy name match",
  manual: "manual match",
  none: "no formulary match",
};

const restrictionsText = (restrictions: CellResult["restrictions"]): string | null => {
  if (!restrictions) return null;
  const parts = [
    restrictions.pa ? "PA" : null,
    restrictions.st ? "ST" : null,
    restrictions.ql ? `QL ${restrictions.ql.quantity}/${restrictions.ql.days}d` : null,
    ...restrictions.extraFlags,
  ].filter((p): p is string => p !== null);
  return parts.length > 0 ? parts.join(" · ") : null;
};

const summaryRestrictionsLabel = (summary: PlanSummary): string | undefined => {
  const parts = [
    summary.paCount > 0 ? `${summary.paCount} PA` : null,
    summary.stCount > 0 ? `${summary.stCount} ST` : null,
    summary.qlCount > 0 ? `${summary.qlCount} QL` : null,
  ].filter((p): p is string => p !== null);
  return parts.length > 0 ? parts.join(" · ") : undefined;
};

/** Best coverage: highest coveredCount, tie broken by lowest est. monthly. Never decorative. */
function bestCoveragePlanId(summaries: PlanSummary[]): string | null {
  if (summaries.length < 2) return null;
  let best: PlanSummary | null = null;
  for (const s of summaries) {
    if (!best) {
      best = s;
      continue;
    }
    const bestEst = best.estMonthlyCents ?? Number.POSITIVE_INFINITY;
    const est = s.estMonthlyCents ?? Number.POSITIVE_INFINITY;
    if (s.coveredCount > best.coveredCount || (s.coveredCount === best.coveredCount && est < bestEst)) {
      best = s;
    }
  }
  return best?.planId ?? null;
}

export default async function ComparisonPage({
  params,
}: {
  params: Promise<{ analysisId: string }>;
}) {
  const { analysisId } = await params;
  const [comparison, pharmacyChoices] = await Promise.all([
    getComparison(analysisId),
    getComparablePharmacies(analysisId),
  ]);
  if (!comparison) notFound();
  if (comparison.plans.length === 0) redirect(`/analysis/${analysisId}/plans`);

  const { client, plans, grid, primaryPharmacy, costMatrix, analysis, entryProvenance } = comparison;

  // Per-plan SoB tier label for tooltips; identity stays the numeric tier.
  const planTierLabel = (planId: string, tier: number): string | null => {
    const labels = plans.find((p) => p.plan.id === planId)?.plan.tierLabels;
    const label =
      tier >= 1 && tier <= 6
        ? labels?.[`t${tier}` as "t1" | "t2" | "t3" | "t4" | "t5" | "t6"]
        : undefined;
    return label && label.trim() !== "" ? label : null;
  };
  const bestPlanId = bestCoveragePlanId(plans.map((p) => p.summary));

  const pharmacyNoteFor = (status: (typeof plans)[number]["pharmacyStatus"]): string | undefined => {
    if (!primaryPharmacy || !status) return undefined;
    switch (status) {
      case "preferred":
        return `${primaryPharmacy.name}: Preferred`;
      case "standard":
        return `${primaryPharmacy.name}: Standard — higher copays`;
      case "out_of_network":
        return `${primaryPharmacy.name}: Not in network`;
    }
  };

  const gridPricingLabel = primaryPharmacy
    ? `${primaryPharmacy.name}'s network status on each plan`
    : "each plan's most efficient in-network pricing";

  return (
    <div className="space-y-6">
      <WorkflowNav analysisId={analysisId} clientId={client.id} current="comparison" />
      <PageHeader
        title={`Comparison — ${client.fullName} · ${analysis.planYear}`}
        actions={
          <>
            <Button asChild variant="secondary">
              <Link href={`/analysis/${analysisId}/plans`}>Change plans</Link>
            </Button>
            <Button asChild>
              <Link href={`/analysis/${analysisId}/report`}>Generate Report →</Link>
            </Button>
          </>
        }
      />

      <div
        className="grid gap-4"
        style={{ gridTemplateColumns: `repeat(${Math.min(plans.length, 3)}, minmax(0, 1fr))` }}
      >
        {plans.map((planColumn) => (
          <PlanSummaryCard
            key={planColumn.plan.id}
            planName={planColumn.plan.name}
            carrier={planColumn.carrierName}
            isCurrentPlan={planColumn.isCurrent}
            pharmacyNote={pharmacyNoteFor(planColumn.pharmacyStatus)}
            coveredCount={planColumn.summary.coveredCount}
            medicationCount={planColumn.summary.totalCount}
            restrictionsLabel={summaryRestrictionsLabel(planColumn.summary)}
            estimatedMonthlyCents={planColumn.summary.estMonthlyCents}
            rxDeductibleCents={planColumn.plan.rxDeductibleCents}
            deductibleTiers={planColumn.plan.deductibleTiers}
            bestCoverage={planColumn.plan.id === bestPlanId}
          />
        ))}
      </div>

      <CostMatrix
        rows={costMatrix}
        plans={plans}
        controls={
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <MailOrderToggle analysisId={analysisId} checked={analysis.includeMailOrder} />
            {pharmacyChoices ? (
              <PharmacyPicker
                analysisId={analysisId}
                options={pharmacyChoices.options}
                selectedIds={pharmacyChoices.selectedIds}
                locked={pharmacyChoices.locked}
              />
            ) : null}
          </div>
        }
      />

      <Card className="overflow-hidden">
        <Table>
          <THead>
            <tr>
              <TH>Medication</TH>
              {plans.map((planColumn) => (
                <TH key={planColumn.plan.id} className="text-center">
                  {planColumn.plan.name}
                  {planColumn.isCurrent ? " (current)" : ""}
                </TH>
              ))}
            </tr>
          </THead>
          <TBody>
            {grid.map((row) => (
              <TRow key={row.medication.id} className="hover:bg-transparent">
                <TCell>
                  <div className="font-semibold">{row.medication.name}</div>
                  {row.medication.dosageText ? (
                    <div className="text-xs text-steel">{row.medication.dosageText}</div>
                  ) : null}
                </TCell>
                {row.cells.map((cell) => {
                  const restrictions = restrictionsText(cell.restrictions);
                  const provenance = cell.matchedEntryId
                    ? entryProvenance[cell.matchedEntryId]
                    : undefined;
                  return (
                    <TCell key={cell.planId} className="text-center">
                      <div className="inline-flex flex-col items-center gap-1">
                        <CoverageCell
                          coverage={cell.coverage}
                          tier={cell.tier ?? undefined}
                          copayCents={cell.copayCents}
                          coinsurancePct={cell.coinsurancePct}
                          substitutionNote={cell.substitutionNote ?? undefined}
                          className={cn(cell.needsConfirmation && "ring-1 ring-restricted")}
                        >
                          <div className="space-y-1.5">
                            <div className="text-eyebrow">Provenance</div>
                            <div className="text-sm font-semibold text-deepwater">
                              {provenance?.rawDrugName ?? row.medication.name}
                            </div>
                            {cell.tier !== null ? (
                              <div
                                className="text-data text-sm text-deepwater"
                                title={planTierLabel(cell.planId, cell.tier) ?? undefined}
                              >
                                Tier {cell.tier}
                                {planTierLabel(cell.planId, cell.tier) ? (
                                  <span className="text-xs font-normal text-steel">
                                    {" "}· {planTierLabel(cell.planId, cell.tier)}
                                  </span>
                                ) : null}
                              </div>
                            ) : null}
                            {provenance?.rawRequirementsText ? (
                              <div className="text-data text-xs text-steel">
                                {provenance.rawRequirementsText}
                              </div>
                            ) : restrictions ? (
                              <div className="text-data text-xs text-steel">{restrictions}</div>
                            ) : null}
                            {cell.substitutionNote ? (
                              <div className="text-xs text-steel">{cell.substitutionNote}</div>
                            ) : null}
                            <div className="text-xs text-steel">
                              Matched via {matchMethodLabels[cell.matchMethod]}
                            </div>
                            {provenance ? (
                              <div className="text-data text-xs text-steel">
                                {provenance.formularyLabel} · p. {provenance.sourcePage}
                              </div>
                            ) : null}
                            {cell.needsConfirmation ? (
                              <div className="rounded-md bg-restricted-soft px-2 py-1 text-xs font-semibold text-restricted">
                                AI-assisted match — confirm before approving
                              </div>
                            ) : null}
                          </div>
                        </CoverageCell>
                        {cell.restrictions &&
                        (cell.restrictions.pa || cell.restrictions.st || cell.restrictions.ql) ? (
                          <div className="flex flex-wrap items-center justify-center gap-1">
                            {cell.restrictions.pa ? <RestrictionChip kind="pa" /> : null}
                            {cell.restrictions.st ? <RestrictionChip kind="st" /> : null}
                            {cell.restrictions.ql ? (
                              <RestrictionChip
                                kind="ql"
                                label={`QL ${cell.restrictions.ql.quantity}/${cell.restrictions.ql.days}d`}
                              />
                            ) : null}
                          </div>
                        ) : null}
                        {cell.needsConfirmation ? (
                          <div className="text-[11px] font-semibold text-restricted">
                            Needs confirmation
                          </div>
                        ) : null}
                      </div>
                    </TCell>
                  );
                })}
              </TRow>
            ))}
          </TBody>
        </Table>
        <p className="border-t border-mist/60 px-4 py-3 text-xs text-steel">
          Per-drug copays shown use {gridPricingLabel}. Compare pharmacies in the cost table above.
          Click any cell to see the exact formulary line it came from.
        </p>
      </Card>
    </div>
  );
}
