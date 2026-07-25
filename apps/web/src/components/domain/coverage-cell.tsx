"use client";

import type { Cents, CoverageStatus } from "@rxsr/core";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { formatUsd } from "@/components/domain/format";
import { cn } from "@/lib/utils";

/**
 * The signature surface — one comparison-grid cell, one glance per answer.
 * Mono `T2 · $8` on white; `covered_equivalent` adds the substitution note;
 * `not_on_formulary` is the only alarming thing an agent ever sees. Pass
 * provenance content as children to get a click-to-open popover ("the exact
 * formulary line it came from").
 */

interface CoverageCellProps {
  coverage: CoverageStatus;
  /** Formulary tier number (1–6). Omit when not on formulary. */
  tier?: number;
  /** 30/90-day copay in integer cents. Mutually exclusive with coinsurancePct in practice. */
  copayCents?: Cents | null;
  /** Coinsurance percentage (e.g. 29 renders "29%"). */
  coinsurancePct?: number | null;
  /** For covered_equivalent: what the plan substitutes (e.g. "as generic estradiol"). */
  substitutionNote?: string;
  onClick?: () => void;
  /** Provenance popover content; when present the cell opens a popover on click. */
  children?: React.ReactNode;
  className?: string;
}

function costText({ copayCents, coinsurancePct }: Pick<CoverageCellProps, "copayCents" | "coinsurancePct">) {
  if (copayCents !== null && copayCents !== undefined) return formatUsd(copayCents);
  if (coinsurancePct !== null && coinsurancePct !== undefined) return `${coinsurancePct}%`;
  return null;
}

function CoverageCell({
  coverage,
  tier,
  copayCents,
  coinsurancePct,
  substitutionNote,
  onClick,
  children,
  className,
}: CoverageCellProps) {
  const negative = coverage === "not_on_formulary" || coverage === "not_covered";
  const cost = costText({ copayCents, coinsurancePct });
  const interactive = Boolean(children) || Boolean(onClick);

  const body = negative ? (
    <span className="text-data text-[13px] font-medium uppercase text-notcovered">
      {coverage === "not_on_formulary" ? "Not on formulary" : "Not covered"}
    </span>
  ) : (
    <>
      <span className="text-data text-sm font-semibold text-deepwater">
        {[tier !== undefined ? `T${tier}` : null, cost].filter(Boolean).join(" · ")}
      </span>
      {coverage === "covered_equivalent" && substitutionNote ? (
        <span className="text-xs leading-tight text-steel">{substitutionNote}</span>
      ) : null}
    </>
  );

  const cellClasses = cn(
    "inline-flex min-h-9 min-w-24 flex-col items-center justify-center gap-0.5 rounded-md px-3 py-1.5 text-center",
    coverage === "not_on_formulary" ? "bg-notcovered-soft" : "bg-white",
    interactive &&
      cn(
        "cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
        coverage === "not_on_formulary" ? "hover:bg-notcovered-soft/70" : "hover:bg-fog",
      ),
    className,
  );

  if (!interactive) {
    return <span className={cellClasses}>{body}</span>;
  }

  if (!children) {
    return (
      <button type="button" onClick={onClick} className={cellClasses}>
        {body}
      </button>
    );
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" onClick={onClick} className={cellClasses}>
          {body}
        </button>
      </PopoverTrigger>
      <PopoverContent align="center" side="bottom" className="w-80">
        {children}
      </PopoverContent>
    </Popover>
  );
}

export { CoverageCell, type CoverageCellProps };
