import { cn } from "@/lib/utils";

/** Consistent empty scaffolding: icon, title, quiet description, optional action. */

interface EmptyStateProps {
  /** A lucide icon element, e.g. <Inbox className="size-8" />. */
  icon?: React.ReactNode;
  title: string;
  description?: string;
  /** Usually a Button — but never variant="rescue"; empty states don't complete jobs. */
  action?: React.ReactNode;
  className?: string;
}

function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-2 rounded-card border border-dashed border-mist bg-white px-6 py-14 text-center",
        className,
      )}
    >
      {icon ? <div className="mb-1 text-mist [&_svg]:size-8">{icon}</div> : null}
      <h3 className="font-display text-base font-extrabold text-deepwater">{title}</h3>
      {description ? <p className="max-w-sm text-sm text-steel">{description}</p> : null}
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}

export { EmptyState, type EmptyStateProps };
