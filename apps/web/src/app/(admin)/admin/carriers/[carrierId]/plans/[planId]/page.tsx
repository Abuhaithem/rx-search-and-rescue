import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ENTRIES_PAGE_SIZE,
  getFormularyEntriesPage,
  getPlanWorkspace,
} from "@/server/queries/plan-workspace";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TBody, TCell, TH, THead, TRow } from "@/components/ui/table";
import { CarrierLogo } from "@/components/domain/carrier-logo";
import { PageHeader } from "@/components/domain/page-header";
import { RestrictionChip } from "@/components/domain/restriction-chip";
import { PlanEditor } from "../../../../plans/_components/plan-editor";
import { AddEntryDialog, EditEntryDialog, EntrySearch } from "./_components/entry-editor";

export const dynamic = "force-dynamic";

interface PlanWorkspacePageProps {
  params: Promise<{ carrierId: string; planId: string }>;
  searchParams: Promise<{ year?: string; q?: string; page?: string; review?: string }>;
}

export default async function PlanWorkspacePage({ params, searchParams }: PlanWorkspacePageProps) {
  const { carrierId, planId } = await params;
  const query = await searchParams;
  const workspace = await getPlanWorkspace(planId);
  if (!workspace || workspace.carrier.id !== carrierId) notFound();

  const year = Number(query.year) || workspace.catalogRow.plan.planYear;
  const q = query.q ?? "";
  const reviewOnly = query.review === "1";
  const page = Math.max(1, Number(query.page) || 1);

  const entries = workspace.formulary
    ? await getFormularyEntriesPage(workspace.formulary.id, { q, page, reviewOnly })
    : null;

  const basePath = `/admin/carriers/${carrierId}/plans/${planId}?year=${year}`;
  const pageHref = (n: number) => {
    const p = new URLSearchParams({ year: String(year) });
    if (q) p.set("q", q);
    if (reviewOnly) p.set("review", "1");
    p.set("page", String(n));
    return `/admin/carriers/${carrierId}/plans/${planId}?${p}`;
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={workspace.catalogRow.plan.name}
        backHref={`/admin/carriers?year=${year}&carrier=${carrierId}`}
        meta={
          <span className="flex items-center gap-2 text-sm text-steel">
            <CarrierLogo
              name={workspace.carrier.name}
              logoUrl={workspace.carrier.logoUrl}
              size={24}
            />
            {workspace.carrier.name} · <span className="text-data">{year}</span>
          </span>
        }
      />

      {/* ── The plan's formulary list ─────────────────────────────────── */}
      <Card>
        <CardContent className="space-y-4 p-5">
          <div className="flex flex-wrap items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-eyebrow">Formulary list</p>
              {workspace.formulary ? (
                <p className="mt-0.5 text-xs text-steel">
                  {workspace.formulary.label} ·{" "}
                  <span className="text-data">
                    {workspace.formulary.totalEntries.toLocaleString()}
                  </span>{" "}
                  drugs
                  {workspace.formulary.needsReview > 0 ? (
                    <span className="ml-1 font-semibold text-restricted">
                      · {workspace.formulary.needsReview} need review
                    </span>
                  ) : null}
                </p>
              ) : null}
            </div>
            {workspace.formulary ? <AddEntryDialog formularyId={workspace.formulary.id} /> : null}
          </div>

          {!workspace.formulary || !entries ? (
            <div className="rounded-card border border-dashed border-mist bg-fog/50 px-6 py-10 text-center">
              <p className="text-sm font-semibold text-deepwater">No formulary list yet</p>
              <p className="mx-auto mt-1 max-w-sm text-sm text-steel">
                Upload this plan&apos;s formulary PDF through the guided flow — the drug list is
                extracted and lands here for editing.
              </p>
              <Button asChild className="mt-4">
                <Link href={`/admin/formularies/upload?year=${year}`}>Load formulary →</Link>
              </Button>
            </div>
          ) : (
            <>
              <EntrySearch basePath={basePath} q={q} reviewOnly={reviewOnly} />
              {entries.rows.length === 0 ? (
                <p className="py-6 text-center text-sm text-steel">
                  No drugs match{q ? <> &ldquo;{q}&rdquo;</> : null}.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <THead>
                      <tr>
                        <TH>Drug name</TH>
                        <TH>Tier</TH>
                        <TH>Requirements</TH>
                        <TH>Page</TH>
                        <TH className="w-12" aria-label="Actions" />
                      </tr>
                    </THead>
                    <TBody>
                      {entries.rows.map((entry) => (
                        <TRow
                          key={entry.id}
                          className={entry.needsReview ? "bg-restricted-soft/30" : undefined}
                        >
                          <TCell>
                            <span className="text-sm text-deepwater">{entry.rawDrugName}</span>
                            {entry.isBrand ? (
                              <span className="ml-2 rounded-chip bg-fog px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase text-steel">
                                Brand
                              </span>
                            ) : null}
                            {entry.needsReview ? (
                              <span className="ml-2 rounded-chip bg-restricted-soft px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase text-restricted">
                                Review
                              </span>
                            ) : null}
                          </TCell>
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
                          <TCell className="text-data text-xs text-steel">
                            {entry.sourcePage || "manual"}
                          </TCell>
                          <TCell>
                            <EditEntryDialog entry={entry} />
                          </TCell>
                        </TRow>
                      ))}
                    </TBody>
                  </Table>
                </div>
              )}
              <div className="flex items-center justify-between border-t border-mist/55 pt-3">
                <p className="text-xs text-steel">
                  <span className="text-data">{entries.total.toLocaleString()}</span> drugs
                  {q ? <> matching &ldquo;{q}&rdquo;</> : null} · page{" "}
                  <span className="text-data">
                    {entries.page} of {entries.pageCount}
                  </span>{" "}
                  ({ENTRIES_PAGE_SIZE}/page)
                </p>
                <div className="flex items-center gap-2">
                  {entries.page > 1 ? (
                    <Button asChild variant="secondary" size="sm">
                      <Link href={pageHref(entries.page - 1)}>← Prev</Link>
                    </Button>
                  ) : null}
                  {entries.page < entries.pageCount ? (
                    <Button asChild variant="secondary" size="sm">
                      <Link href={pageHref(entries.page + 1)}>Next →</Link>
                    </Button>
                  ) : null}
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* ── Pricing (Summary of Benefits data) ────────────────────────── */}
      <PlanEditor key={planId} row={workspace.catalogRow} />

      <p className="text-xs text-steel">
        The pharmacy network is managed once per carrier — set it on the{" "}
        <Link
          href={`/admin/carriers?year=${year}&carrier=${carrierId}`}
          className="font-semibold text-harbor hover:underline"
        >
          {workspace.carrier.name} page
        </Link>
        .
      </p>
    </div>
  );
}
