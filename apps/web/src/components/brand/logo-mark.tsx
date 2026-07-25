import { cn } from "@/lib/utils";

/*
 * The mark: a life ring / tablet / search reticle. Four openings sit exactly on
 * the diagonals (45/135/225/315 deg) — the dash pattern below is four 60-degree
 * arcs centered on the cardinals, so the gaps land on the diagonals. Flat color
 * only: no gradients, no shadows, per brand guidelines.
 *
 * r=19, circumference 119.38: arc = 60deg = 19.9, gap = 30deg = 9.95;
 * dashoffset of half an arc centers the first arc at 3 o'clock.
 */

type LogoMarkVariant = "primary" | "ink";

interface LogoMarkProps {
  /** Rendered size in px. Brand minimum on screen is 24. */
  size?: number;
  /**
   * primary — rescue ring, white Rx (for deepwater surfaces).
   * ink — single-color deepwater, for paper/report contexts.
   */
  variant?: LogoMarkVariant;
  /** Accessible name; decorative when omitted. */
  title?: string;
  className?: string;
}

const ringColor: Record<LogoMarkVariant, string> = {
  primary: "stroke-rescue",
  ink: "stroke-deepwater",
};

const rxColor: Record<LogoMarkVariant, string> = {
  primary: "fill-white",
  ink: "fill-deepwater",
};

function LogoMark({ size = 32, variant = "primary", title, className }: LogoMarkProps) {
  return (
    <svg
      viewBox="0 0 48 48"
      width={size}
      height={size}
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      className={cn("shrink-0", className)}
    >
      {title ? <title>{title}</title> : null}
      <circle
        cx="24"
        cy="24"
        r="19"
        fill="none"
        strokeWidth="7"
        strokeDasharray="19.9 9.95"
        strokeDashoffset="9.95"
        className={ringColor[variant]}
      />
      <text
        x="24"
        y="25"
        textAnchor="middle"
        dominantBaseline="central"
        fontSize="16"
        fontWeight={900}
        fontFamily="var(--font-archivo), Archivo, sans-serif"
        className={rxColor[variant]}
      >
        Rx
      </text>
    </svg>
  );
}

export { LogoMark, type LogoMarkProps };
