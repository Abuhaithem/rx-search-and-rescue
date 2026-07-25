import type { NetworkStatus } from "@rxsr/core";
import { cn } from "@/lib/utils";

/** How a pharmacy sits in a plan's network. Coverage-meaning colors only. */

interface NetworkStatusChipProps {
  status: NetworkStatus;
  className?: string;
}

const networkStyles: Record<NetworkStatus, string> = {
  preferred: "bg-covered-soft text-covered",
  standard: "bg-restricted-soft text-restricted",
  out_of_network: "bg-notcovered-soft text-notcovered",
};

const networkLabels: Record<NetworkStatus, string> = {
  preferred: "In network · Preferred",
  standard: "In network · Standard",
  out_of_network: "Not in network",
};

function NetworkStatusChip({ status, className }: NetworkStatusChipProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center whitespace-nowrap rounded-chip px-2 py-0.5 text-xs font-semibold",
        networkStyles[status],
        className,
      )}
    >
      {networkLabels[status]}
    </span>
  );
}

export { NetworkStatusChip, type NetworkStatusChipProps };
