import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export const WIZARD_STEPS = [
  "Formulary",
  "Preview",
  "Summary of Benefits",
  "Preview",
  "Pharmacy Network",
  "Preview",
  "Finalize",
] as const;

/** 1-indexed step rail; past steps get a check, future steps stay quiet. */
export function WizardStepper({ current }: { current: number }) {
  return (
    <ol className="flex flex-wrap items-center gap-1.5" aria-label="Upload steps">
      {WIZARD_STEPS.map((label, index) => {
        const step = index + 1;
        const state = step < current ? "done" : step === current ? "current" : "todo";
        return (
          <li key={`${label}-${step}`} className="flex items-center gap-1.5">
            {index > 0 ? <span className="h-px w-4 bg-mist" aria-hidden /> : null}
            <span
              className={cn(
                "flex items-center gap-1.5 rounded-chip px-2.5 py-1 font-mono text-[11px] font-semibold uppercase tracking-[0.08em]",
                state === "current" && "bg-deepwater text-white",
                state === "done" && "bg-covered-soft text-covered",
                state === "todo" && "bg-fog text-steel",
              )}
              aria-current={state === "current" ? "step" : undefined}
            >
              {state === "done" ? <Check className="size-3" /> : <span>{step}</span>}
              {label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
