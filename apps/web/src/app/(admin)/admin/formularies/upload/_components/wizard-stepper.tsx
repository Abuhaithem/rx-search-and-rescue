import Link from "next/link";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export const WIZARD_STEPS = [
  "Formulary",
  "Preview",
  "Summary of Benefits",
  "Preview",
  "Finalize",
] as const;

/**
 * 1-indexed step rail; past steps get a check and — once the wizard exists —
 * are LINKS, so disagreeing with a preview means clicking back and
 * re-uploading (staged data is replaced, nothing committed until Finalize).
 */
export function WizardStepper({
  current,
  formularyId,
}: {
  current: number;
  formularyId?: string;
}) {
  return (
    <ol className="flex flex-wrap items-center gap-1.5" aria-label="Upload steps">
      {WIZARD_STEPS.map((label, index) => {
        const step = index + 1;
        const state = step < current ? "done" : step === current ? "current" : "todo";
        const chip = (
          <span
            className={cn(
              "flex items-center gap-1.5 rounded-chip px-2.5 py-1 font-mono text-[11px] font-semibold uppercase tracking-[0.08em]",
              state === "current" && "bg-deepwater text-white",
              state === "done" && "bg-covered-soft text-covered",
              state === "todo" && "bg-fog text-steel",
              state === "done" && formularyId && "transition-opacity hover:opacity-75",
            )}
            aria-current={state === "current" ? "step" : undefined}
          >
            {state === "done" ? <Check className="size-3" /> : <span>{step}</span>}
            {label}
          </span>
        );
        return (
          <li key={`${label}-${step}`} className="flex items-center gap-1.5">
            {index > 0 ? <span className="h-px w-4 bg-mist" aria-hidden /> : null}
            {state === "done" && formularyId && step >= 2 ? (
              <Link href={`/admin/formularies/upload?formulary=${formularyId}&step=${step}`}>
                {chip}
              </Link>
            ) : (
              chip
            )}
          </li>
        );
      })}
    </ol>
  );
}
