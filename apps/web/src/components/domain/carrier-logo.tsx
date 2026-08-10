import { cn } from "@/lib/utils";

interface CarrierLogoProps {
  name: string;
  logoUrl: string | null;
  /** Rendered box size in px. */
  size?: number;
  className?: string;
}

/**
 * Carrier logo with an initials fallback so logo-less carriers still read as
 * deliberate. Logos are presigned S3 URLs — plain <img>, never next/image
 * (the host varies per request).
 */
function CarrierLogo({ name, logoUrl, size = 32, className }: CarrierLogoProps) {
  const initials = name
    .split(/\s+/)
    .filter((word) => /^[A-Za-z]/.test(word))
    .slice(0, 2)
    .map((word) => word[0]!.toUpperCase())
    .join("");

  if (logoUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={logoUrl}
        alt={`${name} logo`}
        width={size}
        height={size}
        className={cn(
          "shrink-0 rounded-md border border-mist/60 bg-white object-contain p-0.5",
          className,
        )}
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span
      aria-hidden
      className={cn(
        "flex shrink-0 items-center justify-center rounded-md bg-harbor/15 font-mono text-[11px] font-semibold uppercase text-harbor",
        className,
      )}
      style={{ width: size, height: size }}
    >
      {initials || "?"}
    </span>
  );
}

export { CarrierLogo, type CarrierLogoProps };
