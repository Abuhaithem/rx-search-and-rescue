import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * The analysis workflow as linked steps, so agents jump straight to Intake
 * Review or Select Plans instead of guessing the back button.
 */
export type WorkflowStep = "intake" | "plans" | "comparison" | "report";

export function WorkflowNav({
  analysisId,
  clientId,
  current,
}: {
  analysisId: string;
  clientId: string;
  current: WorkflowStep;
}) {
  const steps: { key: WorkflowStep; label: string; href: string }[] = [
    { key: "intake", label: "Intake Review", href: `/intake/${clientId}` },
    { key: "plans", label: "Select Plans", href: `/analysis/${analysisId}/plans` },
    { key: "comparison", label: "Comparison", href: `/analysis/${analysisId}` },
    { key: "report", label: "Report", href: `/analysis/${analysisId}/report` },
  ];

  return (
    <nav
      aria-label="Analysis steps"
      className="flex flex-wrap items-center gap-1 text-sm text-steel"
    >
      {steps.map((step, index) => (
        <span key={step.key} className="flex items-center gap-1">
          {index > 0 ? <span className="text-mist">/</span> : null}
          <Link
            href={step.href}
            aria-current={current === step.key ? "page" : undefined}
            className={cn(
              "rounded-md px-2 py-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
              current === step.key
                ? "bg-fog font-semibold text-deepwater"
                : "hover:bg-fog hover:text-deepwater",
            )}
          >
            {step.label}
          </Link>
        </span>
      ))}
    </nav>
  );
}
