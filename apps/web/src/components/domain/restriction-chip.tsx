import { cn } from "@/lib/utils";

/**
 * Formulary restriction flag: prior auth, step therapy, quantity limit, or a
 * verbatim custom flag. Always restricted-soft — restriction is a coverage
 * meaning, never decorative. Pass `label` for specifics (e.g. "QL 90/30d").
 */

type RestrictionKind = "pa" | "st" | "ql" | "custom";

interface RestrictionChipProps {
  kind: RestrictionKind;
  /** Overrides the default abbreviation; required for kind="custom". */
  label?: string;
  className?: string;
}

const defaultLabels: Record<Exclude<RestrictionKind, "custom">, string> = {
  pa: "PA",
  st: "ST",
  ql: "QL",
};

function RestrictionChip({ kind, label, className }: RestrictionChipProps) {
  const text = label ?? (kind === "custom" ? "" : defaultLabels[kind]);
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-chip bg-restricted-soft px-1.5 py-0.5 font-mono text-[11px] font-medium uppercase tracking-[0.04em] text-restricted",
        className,
      )}
      title={kind === "pa" ? "Prior authorization" : kind === "st" ? "Step therapy" : kind === "ql" ? "Quantity limit" : undefined}
    >
      {text}
    </span>
  );
}

export { RestrictionChip, type RestrictionChipProps, type RestrictionKind };
