import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Page scaffolding: Archivo-heavy title left, actions right. `backHref`
 * renders the "← Back" link the walkthrough shows on every drill-in screen;
 * `meta` sits beside the title (StatusChip, plan-year, client name).
 */

interface PageHeaderProps {
  title: string;
  /** Right-aligned action row — remember: at most one rescue Button per screen. */
  actions?: React.ReactNode;
  backHref?: string;
  /** Inline chip/metadata rendered after the title (e.g. <StatusChip />). */
  meta?: React.ReactNode;
  className?: string;
}

function PageHeader({ title, actions, backHref, meta, className }: PageHeaderProps) {
  return (
    <header className={cn("flex flex-wrap items-center gap-x-4 gap-y-3", className)}>
      {backHref ? (
        <Link
          href={backHref}
          className="inline-flex items-center gap-1 rounded-md text-sm text-steel transition-colors hover:text-deepwater focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <ArrowLeft className="size-4" />
          Back
        </Link>
      ) : null}
      <h1 className="font-display text-2xl font-extrabold leading-tight text-deepwater">{title}</h1>
      {meta}
      {actions ? <div className="ml-auto flex items-center gap-2">{actions}</div> : null}
    </header>
  );
}

export { PageHeader, type PageHeaderProps };
