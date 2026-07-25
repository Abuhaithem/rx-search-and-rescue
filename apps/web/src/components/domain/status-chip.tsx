import type { AnalysisStatus } from "@rxsr/core";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

/** Workflow status chip (Work Queue). Mono uppercase 11px, meaning-mapped colors. */

interface StatusChipProps {
  status: AnalysisStatus;
  className?: string;
}

const statusStyles: Record<AnalysisStatus, string> = {
  new: "bg-fog text-steel",
  in_review: "bg-restricted-soft text-restricted",
  approved: "bg-covered-soft text-covered",
  delivered: "bg-covered-soft text-covered",
};

const statusLabels: Record<AnalysisStatus, string> = {
  new: "New",
  in_review: "In review",
  approved: "Approved",
  delivered: "Delivered",
};

function StatusChip({ status, className }: StatusChipProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-chip px-2 py-0.5 font-mono text-[11px] font-medium uppercase tracking-[0.08em]",
        statusStyles[status],
        className,
      )}
    >
      {statusLabels[status]}
      {status === "delivered" ? <Check className="size-3" strokeWidth={3} /> : null}
    </span>
  );
}

export { StatusChip, type StatusChipProps };
