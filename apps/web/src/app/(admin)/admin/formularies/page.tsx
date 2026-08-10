import Link from "next/link";
import { FileSearch } from "lucide-react";
import { PageHeader } from "@/components/domain/page-header";
import { EmptyState } from "@/components/domain/empty-state";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { getFormularies, getFormularyReviewRows } from "@/server/queries/formularies";
import { listCarriers } from "../_lib/carriers";
import { ActivateFormularyButton } from "./_components/activate-button";
import { FormularyStatusBadge, formularyStatusLabels } from "./_components/formulary-status-badge";
import { RefreshPoller } from "./_components/refresh-poller";
import { ReviewTable } from "./_components/review-table";
import { UploadFormularyDialog } from "./_components/upload-formulary-dialog";

interface PageProps {
  searchParams: Promise<{ year?: string; formulary?: string }>;
}

export default async function FormulariesPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const year = Number.parseInt(params.year ?? "", 10) || new Date().getFullYear();

  const [formularyRows, carrierOptions] = await Promise.all([
    getFormularies(year),
    listCarriers(),
  ]);

  const latest = formularyRows[0] ?? null;
  const selected = formularyRows.find((f) => f.id === params.formulary) ?? latest;
  const reviewRows = selected ? await getFormularyReviewRows(selected.id) : [];
  const others = formularyRows.filter((f) => f.id !== selected?.id);
  const indexCount = selected?.stats?.indexCount ?? null;

  return (
    <div className="space-y-8">
      <RefreshPoller active={formularyRows.some((f) => f.status === "ingesting")} />

      <PageHeader
        title={`Formularies — Plan Year ${year}`}
        actions={
          <Button asChild>
            <Link href={`/admin/formularies/upload?year=${year}`}>Load formulary →</Link>
          </Button>
        }
      />

      {!selected ? (
        <EmptyState
          icon={<FileSearch />}
          title={`No formularies for ${year} yet`}
          description="When carriers release the new drug lists, upload each PDF here. The system reads every drug, double-checks itself, and nothing goes live until you click Activate."
        />
      ) : (
        <>
          {/* Stats card row for the most recent (or selected) upload. */}
          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <Card>
              <CardContent className="space-y-1.5 p-5">
                <p className="text-eyebrow">
                  {selected.id === latest?.id ? "Just uploaded" : "Selected formulary"}
                </p>
                <p className="text-sm font-semibold leading-snug text-deepwater">
                  {selected.label}
                </p>
                <p className="text-xs text-steel">
                  Covers <span className="text-data">{selected.planCount}</span>{" "}
                  {selected.planCount === 1 ? "plan" : "plans"}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="space-y-2 p-5">
                <p className="text-eyebrow">Drugs read</p>
                <p className="text-data text-3xl font-semibold text-deepwater">
                  {selected.entryCount.toLocaleString("en-US")}
                </p>
                {indexCount != null && indexCount > 0 ? (
                  <>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-mist/40">
                      <div
                        className="h-full rounded-full bg-covered"
                        style={{
                          width: `${Math.min(100, Math.round((selected.entryCount / indexCount) * 100))}%`,
                        }}
                      />
                    </div>
                    <p className="text-xs text-steel">
                      matches document index:{" "}
                      <span className="text-data">{indexCount.toLocaleString("en-US")}</span>
                      {selected.entryCount === indexCount ? (
                        <span className="text-covered"> ✓</span>
                      ) : null}
                    </p>
                  </>
                ) : null}
              </CardContent>
            </Card>

            <Card>
              <CardContent className="space-y-1.5 p-5">
                <p className="text-eyebrow">Needs a human look</p>
                <p
                  className={cn(
                    "text-data text-3xl font-semibold",
                    selected.needsReviewCount > 0 ? "text-restricted" : "text-deepwater",
                  )}
                >
                  {selected.needsReviewCount}{" "}
                  <span className="text-base">{selected.needsReviewCount === 1 ? "row" : "rows"}</span>
                </p>
                <p className="text-xs text-steel">
                  {selected.needsReviewCount > 0
                    ? "two readings disagreed — review below"
                    : "both readings agreed everywhere"}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="space-y-3 p-5">
                <p className="text-eyebrow">Status</p>
                <FormularyStatusBadge status={selected.status} />
                <div>
                  <ActivateFormularyButton
                    formularyId={selected.id}
                    year={year}
                    disabled={selected.needsReviewCount > 0 || selected.status === "active"}
                  />
                </div>
              </CardContent>
            </Card>
          </section>

          <ReviewTable key={selected.id} rows={reviewRows} />

          {/* Next-step banner: amber = needs attention, links straight to screen 7. */}
          <Card className="border-restricted/40 bg-restricted-soft shadow-none">
            <CardContent className="flex flex-wrap items-center gap-x-4 gap-y-3 p-4">
              <p className="min-w-64 flex-1 text-sm leading-relaxed text-deepwater">
                <span className="font-semibold text-restricted">Next step after activation:</span>{" "}
                the plans on this formulary&apos;s cover page are added to your Plan Catalog
                automatically — the admin never creates plans by hand after an upload. Each plan
                still needs its {year} costs entered from its Summary of Benefits.
              </p>
              <Button asChild size="sm">
                <Link href={`/admin/plans?year=${year}`}>Complete plans in Plan Catalog →</Link>
              </Button>
            </CardContent>
          </Card>

          <p className="border-t border-mist/70 pt-3 text-xs text-steel">
            Already loaded for <span className="text-data">{year}</span>:{" "}
            {others.length === 0 ? (
              "none yet"
            ) : (
              others.map((f, i) => (
                <span key={f.id}>
                  {i > 0 ? " · " : ""}
                  <Link
                    href={`/admin/formularies?year=${year}&formulary=${f.id}`}
                    className="underline-offset-2 hover:text-deepwater hover:underline"
                  >
                    {f.label}
                  </Link>{" "}
                  {f.status === "active" ? (
                    <span className="text-covered">✓</span>
                  ) : (
                    <span className="font-mono text-[10px] uppercase tracking-[0.08em]">
                      {formularyStatusLabels[f.status]}
                    </span>
                  )}
                </span>
              ))
            )}
            {" "}| Past-year formularies remain available for current-year reviews and past-report
            records.
          </p>
        </>
      )}
    </div>
  );
}
