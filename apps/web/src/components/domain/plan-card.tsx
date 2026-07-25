"use client";

import type { Cents, NetworkStatus } from "@rxsr/core";
import { TriangleAlert } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { NetworkStatusChip } from "@/components/domain/network-status-chip";
import { formatUsd } from "@/components/domain/format";
import { cn } from "@/lib/utils";

/**
 * Select Plans card (screen 3): checkbox + plan identity, then PREMIUM /
 * RX DEDUCTIBLE / pharmacy-fit columns as eyebrow label over mono value.
 * A `warning` (e.g. missing formulary or costs) replaces the pharmacy column
 * and disables selection unless explicitly allowed upstream.
 */

interface PlanCardProps {
  planName: string;
  carrier: string;
  premiumCents: Cents;
  rxDeductibleCents: Cents;
  selected: boolean;
  onSelectedChange: (selected: boolean) => void;
  isCurrentPlan?: boolean;
  disabled?: boolean;
  /** Client's pharmacy name — becomes the third column's eyebrow label. */
  pharmacyName?: string;
  /** How that pharmacy sits in this plan's network. */
  pharmacyStatus?: NetworkStatus;
  /** e.g. { label: "2027 formulary", message: "Missing" } — plan not comparable yet. */
  warning?: { label: string; message: string };
  className?: string;
}

function PlanCard({
  planName,
  carrier,
  premiumCents,
  rxDeductibleCents,
  selected,
  onSelectedChange,
  isCurrentPlan = false,
  disabled = false,
  pharmacyName,
  pharmacyStatus,
  warning,
  className,
}: PlanCardProps) {
  return (
    <label
      data-selected={selected || undefined}
      className={cn(
        "block cursor-pointer rounded-card border border-mist/80 bg-white p-4 shadow-card transition-colors",
        selected && "border-harbor ring-1 ring-harbor",
        disabled ? "cursor-not-allowed opacity-60" : "hover:border-steel/60",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2.5">
          <Checkbox
            checked={selected}
            onCheckedChange={(checked) => onSelectedChange(checked === true)}
            disabled={disabled}
            aria-label={`Select ${planName}`}
            className="mt-0.5"
          />
          <div>
            <div className="text-sm font-semibold leading-tight text-deepwater">{planName}</div>
            <div className="mt-0.5 text-xs text-steel">{carrier}</div>
          </div>
        </div>
        {isCurrentPlan ? (
          <span className="shrink-0 rounded-chip bg-deepwater px-2 py-0.5 font-mono text-[10px] font-medium uppercase tracking-[0.1em] text-white">
            Current plan
          </span>
        ) : null}
      </div>

      <div className="mt-4 flex items-end gap-6">
        <div>
          <div className="text-eyebrow">Premium</div>
          <div className="text-data mt-1 text-sm font-semibold text-deepwater">
            {formatUsd(premiumCents)}
          </div>
        </div>
        <div>
          <div className="text-eyebrow">Rx deductible</div>
          <div className="text-data mt-1 text-sm font-semibold text-deepwater">
            {formatUsd(rxDeductibleCents)}
          </div>
        </div>
        {warning ? (
          <div>
            <div className="text-eyebrow">{warning.label}</div>
            <span className="mt-1 inline-flex items-center gap-1 rounded-chip bg-restricted-soft px-2 py-0.5 text-xs font-semibold text-restricted">
              {warning.message}
              <TriangleAlert className="size-3" />
            </span>
          </div>
        ) : pharmacyName && pharmacyStatus ? (
          <div>
            <div className="text-eyebrow">{pharmacyName}</div>
            <NetworkStatusChip status={pharmacyStatus} className="mt-1" />
          </div>
        ) : null}
      </div>
    </label>
  );
}

export { PlanCard, type PlanCardProps };
