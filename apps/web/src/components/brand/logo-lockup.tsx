import { LogoMark } from "@/components/brand/logo-mark";
import { cn } from "@/lib/utils";

/*
 * Horizontal lockup for the deepwater app bar: mark + Archivo Black wordmark,
 * uppercase, tracked wide. The ampersand is the only place the accent color
 * enters type. Wordmark inherits currentColor so the same lockup works on
 * dark (white text) and paper (deepwater text).
 */

interface LogoLockupProps {
  /** Show the "Medicare drug-coverage analysis" tagline under the wordmark. */
  tagline?: boolean;
  className?: string;
}

function LogoLockup({ tagline = false, className }: LogoLockupProps) {
  return (
    <span className={cn("inline-flex items-center gap-3", className)}>
      <LogoMark size={28} />
      <span className="flex flex-col gap-0.5">
        <span className="font-display text-[15px] font-black uppercase leading-none tracking-[0.18em]">
          Rx Search <span className="text-rescue">&amp;</span> Rescue
        </span>
        {tagline ? (
          <span className="font-mono text-[9px] uppercase tracking-[0.22em] opacity-70">
            Medicare drug-coverage analysis
          </span>
        ) : null}
      </span>
    </span>
  );
}

export { LogoLockup, type LogoLockupProps };
