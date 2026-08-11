import Link from "next/link";
import { notFound } from "next/navigation";
import { getCarrierCatalog, getPlanYears } from "@/server/queries/carriers";
import { getFormularyReviewRows } from "@/server/queries/formularies";
import { getWizardState, type WizardStagedTierCost } from "@/server/queries/wizard";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TBody, TCell, TH, THead, TRow } from "@/components/ui/table";
import { NetworkStatusChip } from "@/components/domain/network-status-chip";
import { PageHeader } from "@/components/domain/page-header";
import { RestrictionChip } from "@/components/domain/restriction-chip";
import { formatUsd } from "@/components/domain/format";
import { RefreshPoller } from "../_components/refresh-poller";
import { ReviewTable } from "../_components/review-table";
import {
  DirectoryUploadForm,
  FinalizeButton,
  PlanNamesApprove,
  SobUploadForm,
  StepUploadForm,
} from "./_components/step-forms";
import { WizardStepper } from "./_components/wizard-stepper";

export const dynamic = "force-dynamic";

interface WizardPageProps {
  searchParams: Promise<{ formulary?: string; step?: string; year?: string }>;
}

const CHANNEL_SHORT: Record<string, string> = {
  preferred_retail: "Preferred retail",
  standard_retail: "Standard retail",
  preferred_mail: "Preferred mail",
  standard_mail: "Mail order",
};

function costLabel(cost: WizardStagedTierCost): string {
  if (cost.copayCents !== null) return formatUsd(cost.copayCents);
  if (cost.coinsurancePct !== null) {
    return `${cost.coinsurancePct}%${cost.maxCents !== null ? ` up to ${formatUsd(cost.maxCents)}` : ""}`;
  }
  return "—";
}

export default async function FormularyWizardPage({ searchParams }: WizardPageProps) {
  const params = await searchParams;
  const fallbackYear = new Date().getFullYear();

  if (!params.formulary) {
    const year = Number(params.year) || fallbackYear;
    const [carriers, years] = await Promise.all([
      getCarrierCatalog(year),
      getPlanYears(fallbackYear, { includePlanning: true }),
    ]);
    return (
      <div className="space-y-6">
        <PageHeader
          title="Add a drug plan"
          description="A drug plan is its formulary list plus its Summary of Benefits. Upload the documents, review each preview — nothing goes live until the final step."
          backHref={`/admin/carriers?year=${year}`}
        />
        <WizardStepper current={1} />
        <Card>
          <CardContent className="p-6">
            <StepUploadForm
              carriers={carriers.map((c) => ({ id: c.id, name: c.name, logoUrl: c.logoUrl }))}
              years={years}
              defaultYear={year}
            />
          </CardContent>
        </Card>
      </div>
    );
  }

  const state = await getWizardState(params.formulary);
  if (!state) notFound();
  const step = Math.min(Math.max(Number(params.step) || 2, 2), 7);
  const reviewRows =
    step === 2 && state.needsReviewCount > 0
      ? await getFormularyReviewRows(params.formulary)
      : [];
  const { formulary } = state;
  const stepHref = (n: number) => `/admin/formularies/upload?formulary=${formulary.id}&step=${n}`;
  const runningJob = state.jobs.find((j) => j.status === "queued" || j.status === "running");
  const failedJob = state.jobs.find((j) => j.status === "failed");
  const totalEntries = state.tierDistribution.reduce((sum, t) => sum + t.count, 0);

  return (
    <div className="space-y-6">
      <RefreshPoller active={Boolean(runningJob)} />
      <PageHeader
        title={`${formulary.carrierName} — ${formulary.label}`}
        description={`Plan year ${formulary.planYear}`}
        backHref={`/admin/carriers?year=${formulary.planYear}`}
      />
      <WizardStepper current={step} />

      {failedJob ? (
        <Card className="border-notcovered/40 bg-notcovered-soft/40">
          <CardContent className="p-4 text-sm text-notcovered">
            A processing job failed: {failedJob.error ?? "unknown error"}. Re-upload the document
            to retry.
          </CardContent>
        </Card>
      ) : null}

      {step === 2 ? (
        <div className="space-y-6">
          {formulary.status === "ingesting" ? (
            <Card>
              <CardContent className="p-6 text-sm text-steel">
                <span className="font-semibold text-deepwater">Reading the formulary…</span>{" "}
                {runningJob?.message ?? "Extraction in progress"} — this page refreshes itself.
              </CardContent>
            </Card>
          ) : (
            <>
              <section className="grid gap-4 md:grid-cols-3">
                <Card>
                  <CardContent className="space-y-1.5 p-5">
                    <p className="text-eyebrow">Drugs extracted</p>
                    <p className="text-data text-3xl font-semibold text-deepwater">
                      {totalEntries.toLocaleString()}
                    </p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="space-y-1.5 p-5">
                    <p className="text-eyebrow">Needs review</p>
                    <p
                      className={`text-data text-3xl font-semibold ${state.needsReviewCount > 0 ? "text-restricted" : "text-covered"}`}
                    >
                      {state.needsReviewCount}
                    </p>
                    {state.needsReviewCount > 0 ? (
                      <p className="text-xs text-steel">Resolve the flagged rows below.</p>
                    ) : null}
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="space-y-1.5 p-5">
                    <p className="text-eyebrow">Tier distribution</p>
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      {state.tierDistribution.map((t) => (
                        <span
                          key={t.tier}
                          className="rounded-chip bg-fog px-2 py-0.5 font-mono text-xs font-semibold text-deepwater"
                        >
                          T{t.tier} · {t.count.toLocaleString()}
                        </span>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </section>

              <Card>
                <CardContent className="p-0">
                  <Table>
                    <THead>
                      <tr>
                        <TH>Drug name</TH>
                        <TH>Tier</TH>
                        <TH>Requirements</TH>
                        <TH>Page</TH>
                      </tr>
                    </THead>
                    <TBody>
                      {state.entrySample.map((entry, i) => (
                        <TRow key={i} className="hover:bg-transparent">
                          <TCell className="text-sm text-deepwater">{entry.rawDrugName}</TCell>
                          <TCell>
                            <span className="text-data rounded-chip bg-fog px-2 py-0.5 text-xs font-semibold">
                              T{entry.tier}
                            </span>
                          </TCell>
                          <TCell>
                            {entry.rawRequirementsText ? (
                              <RestrictionChip kind="custom" label={entry.rawRequirementsText} />
                            ) : (
                              <span className="text-xs text-steel">—</span>
                            )}
                          </TCell>
                          <TCell className="text-data text-xs text-steel">{entry.sourcePage}</TCell>
                        </TRow>
                      ))}
                    </TBody>
                  </Table>
                  <p className="border-t border-mist/55 px-4 py-2 text-xs text-steel">
                    First {state.entrySample.length} of {totalEntries.toLocaleString()} rows.
                  </p>
                </CardContent>
              </Card>

              {reviewRows.length > 0 ? <ReviewTable rows={reviewRows} /> : null}

              <Card>
                <CardContent className="p-6">
                  <PlanNamesApprove
                    formularyId={formulary.id}
                    initialNames={
                      state.plans.length > 0
                        ? state.plans.map((p) => p.name)
                        : (formulary.stats?.extractedPlanNames ?? [])
                    }
                    disabled={state.needsReviewCount > 0}
                  />
                </CardContent>
              </Card>
            </>
          )}
        </div>
      ) : null}

      {step === 3 ? (
        <Card>
          <CardContent className="space-y-4 p-6">
            <SobUploadForm
              formularyId={formulary.id}
              plans={state.plans.map((p) => ({ id: p.id, name: p.name, sobPath: p.sobPath }))}
            />
            <div className="flex items-center justify-between border-t border-mist/55 pt-4">
              <p className="text-xs text-steel">
                {runningJob ? runningJob.message : "Upload one SBC per plan (or one covering several)."}
              </p>
              <Button asChild variant="secondary">
                <Link href={stepHref(4)}>Preview cost sharing →</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {step === 4 ? (
        <div className="space-y-6">
          {state.plans.map((plan) => (
            <Card key={plan.id}>
              <CardContent className="space-y-3 p-5">
                <div className="flex flex-wrap items-center gap-3">
                  <h3 className="text-sm font-semibold text-deepwater">{plan.name}</h3>
                  {plan.sobStaged?.premiumCents != null ? (
                    <span className="text-data text-xs text-steel">
                      Premium {formatUsd(plan.sobStaged.premiumCents)}/mo
                    </span>
                  ) : null}
                  {plan.sobStaged?.rxDeductibleCents != null ? (
                    <span className="text-data text-xs text-steel">
                      Deductible {formatUsd(plan.sobStaged.rxDeductibleCents)}
                      {plan.sobStaged.deductibleTiers?.length
                        ? ` (tiers ${plan.sobStaged.deductibleTiers.join(", ")})`
                        : ""}
                    </span>
                  ) : null}
                </div>
                {plan.stagedTierCosts.length === 0 ? (
                  <p className="text-sm text-steel">
                    No staged cost sharing yet — upload this plan&apos;s Summary of Benefits in the
                    previous step.
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <THead>
                        <tr>
                          <TH>Tier</TH>
                          <TH>Channel</TH>
                          <TH>Supply</TH>
                          <TH>Member pays</TH>
                        </tr>
                      </THead>
                      <TBody>
                        {plan.stagedTierCosts.map((cost, i) => (
                          <TRow key={i} className="hover:bg-transparent">
                            <TCell className="text-data text-sm font-semibold text-deepwater">
                              {cost.tier.toUpperCase()}
                              {plan.sobStaged?.tierLabels?.[cost.tier] ? (
                                <span className="ml-2 font-sans text-xs font-normal text-steel">
                                  {plan.sobStaged.tierLabels[cost.tier]}
                                </span>
                              ) : null}
                            </TCell>
                            <TCell className="text-sm text-deepwater">
                              {CHANNEL_SHORT[cost.channel] ?? cost.channel}
                            </TCell>
                            <TCell className="text-data text-xs text-steel">
                              {cost.daysSupply}-day
                            </TCell>
                            <TCell className="text-data text-sm font-semibold text-deepwater">
                              {costLabel(cost)}
                            </TCell>
                          </TRow>
                        ))}
                      </TBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
          <div className="flex justify-end">
            <Button asChild>
              <Link href={stepHref(5)}>Looks right — continue to pharmacy network →</Link>
            </Button>
          </div>
        </div>
      ) : null}

      {step === 5 ? (
        <Card>
          <CardContent className="space-y-4 p-6">
            <DirectoryUploadForm formularyId={formulary.id} />
            <div className="flex items-center justify-between border-t border-mist/55 pt-4">
              <p className="text-xs text-steel">
                {runningJob
                  ? runningJob.message
                  : "One directory for the whole carrier: every plan shares this network. Rows land as a staged preview — nothing is live yet."}
              </p>
              <Button asChild variant="secondary">
                <Link href={stepHref(6)}>Preview network →</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {step === 6 ? (
        <div className="space-y-6">
          <section className="grid gap-4 md:grid-cols-3">
            {(["preferred", "standard", "out_of_network"] as const).map((status) => (
              <Card key={status}>
                <CardContent className="space-y-1.5 p-5">
                  <NetworkStatusChip status={status} />
                  <p className="text-data text-3xl font-semibold text-deepwater">
                    {state.stagedNetwork.byStatus[status].toLocaleString()}
                  </p>
                </CardContent>
              </Card>
            ))}
          </section>
          <Card>
            <CardContent className="p-0">
              <Table>
                <THead>
                  <tr>
                    <TH>Pharmacy</TH>
                    <TH>Status</TH>
                  </tr>
                </THead>
                <TBody>
                  {state.stagedNetwork.sample.map((row, i) => (
                    <TRow key={i} className="hover:bg-transparent">
                      <TCell>
                        <span className="text-sm font-medium text-deepwater">{row.pharmacyName}</span>
                        {row.city ? <span className="ml-2 text-xs text-steel">{row.city}</span> : null}
                      </TCell>
                      <TCell>
                        <NetworkStatusChip status={row.status} />
                      </TCell>
                    </TRow>
                  ))}
                </TBody>
              </Table>
              <p className="border-t border-mist/55 px-4 py-2 text-xs text-steel">
                {state.stagedNetwork.total.toLocaleString()} staged pharmacies on the carrier
                network — shared by all {state.plans.length} plans.
              </p>
            </CardContent>
          </Card>
          <div className="flex justify-end">
            <Button asChild>
              <Link href={stepHref(7)}>Looks right — continue to finalize →</Link>
            </Button>
          </div>
        </div>
      ) : null}

      {step === 7 ? (
        <Card>
          <CardContent className="space-y-4 p-6">
            <p className="text-eyebrow">Ready to commit</p>
            <ul className="space-y-1 text-sm text-deepwater">
              <li>
                <span className="text-data font-semibold">{totalEntries.toLocaleString()}</span> drug
                entries → formulary becomes <span className="font-semibold">active</span>
              </li>
              <li>
                <span className="text-data font-semibold">{state.plans.length}</span> plans linked
                {state.plans.filter((p) => p.stagedTierCosts.length > 0).length > 0
                  ? ` — ${state.plans.filter((p) => p.stagedTierCosts.length > 0).length} with staged cost sharing`
                  : " — no staged cost sharing (plans stay unpriced)"}
              </li>
              <li>
                <span className="text-data font-semibold">
                  {state.stagedNetwork.total.toLocaleString()}
                </span>{" "}
                pharmacy network links go live
              </li>
            </ul>
            <p className="text-xs text-steel">
              This is the only step that changes what agents see. Everything before it was staging.
            </p>
            <FinalizeButton formularyId={formulary.id} planYear={formulary.planYear} />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
