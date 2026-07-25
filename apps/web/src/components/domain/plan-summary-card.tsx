import type { Cents } from "@rxsr/core";
import { formatUsd } from "@/components/domain/format";
import { cn } from "@/lib/utils";

/**
 * Comparison-header strip card (screen 4): plan identity, pharmacy pricing
 * line, and the COVERED / RESTRICTIONS / EST. MONTHLY mono stats. The
 * BEST COVERAGE badge is computed upstream — never decorative here.
 */

interface PlanSummaryCardProps {
  planName: string;
  carrier: string;
  isCurrentPlan?: boolean;
  /** e.g. "Valley Apoth.: Standard — higher copays". Computed upstream. */
  pharmacyNote?: string;
  coveredCount: number;
  medicationCount: number;
  /** e.g. "1 PA · 1 QL". Empty/undefined renders "none". */
  restrictionsLabel?: string;
  /** null when the estimate cannot be computed for this channel. */
  estimatedMonthlyCents: Cents | null;
  /** Set only by the analysis engine's comparison — never by hand. */
  bestCoverage?: boolean;
  className?: string;
}

function PlanSummaryCard({
  planName,
  carrier,
  isCurrentPlan = false,
  pharmacyNote,
  coveredCount,
  medicationCount,
  restrictionsLabel,
  estimatedMonthlyCents,
  bestCoverage = false,
  className,
}: PlanSummaryCardProps) {
  const meta = [carrier, isCurrentPlan ? "current plan" : null, pharmacyNote]
    .filter(Boolean)
    .join(" · ");

  return (
    <div
      className={cn(
        "rounded-card border bg-white p-4 shadow-card",
        bestCoverage ? "border-covered" : "border-mist/80",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="text-sm font-semibold leading-tight text-deepwater">{planName}</div>
        {bestCoverage ? (
          <span className="shrink-0 rounded-chip bg-covered-soft px-2 py-0.5 font-mono text-[10px] font-medium uppercase tracking-[0.1em] text-covered">
            Best coverage
          </span>
        ) : null}
      </div>
      <div className="mt-0.5 text-xs text-steel">{meta}</div>

      <div className="mt-3 flex items-end gap-6">
        <div>
          <div className="text-eyebrow">Covered</div>
          <div
            className={cn(
              "text-data mt-1 text-sm font-semibold",
              coveredCount < medicationCount ? "text-notcovered" : "text-deepwater",
            )}
          >
            {coveredCount} of {medicationCount}
          </div>
        </div>
        <div>
          <div className="text-eyebrow">Restrictions</div>
          <div className="text-data mt-1 text-sm font-semibold text-deepwater">
            {restrictionsLabel || "none"}
          </div>
        </div>
        <div>
          <div className="text-eyebrow">Est. monthly at this pharmacy</div>
          <div className="text-data mt-1 text-sm font-semibold text-deepwater">
            {estimatedMonthlyCents === null ? "—" : formatUsd(estimatedMonthlyCents)}
          </div>
        </div>
      </div>
    </div>
  );
}

export { PlanSummaryCard, type PlanSummaryCardProps };
