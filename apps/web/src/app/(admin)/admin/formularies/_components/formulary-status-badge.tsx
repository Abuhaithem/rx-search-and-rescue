import { cn } from "@/lib/utils";
import type { FormularyListRow } from "@/server/queries/formularies";

/*
 * There is no generic Badge primitive in ui/ yet, so this colocated chip
 * follows the StatusChip recipe (mono uppercase 11px, meaning-mapped softs)
 * for the formulary lifecycle. Amber = still needs attention.
 */

type FormularyStatus = FormularyListRow["status"];

const statusStyles: Record<FormularyStatus, string> = {
  ingesting: "bg-restricted-soft text-restricted",
  qa: "bg-restricted-soft text-restricted",
  active: "bg-covered-soft text-covered",
  superseded: "bg-fog text-steel",
};

export const formularyStatusLabels: Record<FormularyStatus, string> = {
  ingesting: "Checking",
  qa: "QA",
  active: "Active",
  superseded: "Superseded",
};

export function FormularyStatusBadge({
  status,
  className,
}: {
  status: FormularyStatus;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-chip px-2 py-0.5 font-mono text-[11px] font-medium uppercase tracking-[0.08em]",
        statusStyles[status],
        className,
      )}
    >
      {formularyStatusLabels[status]}
    </span>
  );
}
