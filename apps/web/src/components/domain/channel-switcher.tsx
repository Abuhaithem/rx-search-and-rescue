"use client";

import type { PharmacyChannel } from "@rxsr/core";
import { useId } from "react";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { cn } from "@/lib/utils";

/**
 * "Price at:" radio strip (screen 4). Switching reprices the whole grid.
 * The client-pharmacy option only renders when a name is provided (an Rx
 * Collect with no preferred pharmacy defaults to preferred retail upstream).
 */

type ChannelValue = PharmacyChannel | "client";

interface ChannelSwitcherProps {
  value: ChannelValue;
  onChange: (value: ChannelValue) => void;
  /** The client's preferred pharmacy; omits the "client" option when absent. */
  clientPharmacyName?: string;
  className?: string;
}

function ChannelSwitcher({ value, onChange, clientPharmacyName, className }: ChannelSwitcherProps) {
  const id = useId();

  const options: { value: ChannelValue; label: React.ReactNode }[] = [
    ...(clientPharmacyName
      ? [
          {
            value: "client" as const,
            label: (
              <>
                <span className="font-semibold">{clientPharmacyName}</span>
                <span className="text-steel"> (client&rsquo;s pharmacy — 30-day)</span>
              </>
            ),
          },
        ]
      : []),
    { value: "preferred_retail", label: "Preferred retail" },
    { value: "standard_retail", label: "Standard retail" },
    { value: "mail_order", label: "Mail order (90-day)" },
  ];

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-5 gap-y-2 rounded-card border border-mist/60 bg-fog px-4 py-2.5",
        className,
      )}
    >
      <span className="text-eyebrow">Price at</span>
      <RadioGroup
        value={value}
        onValueChange={(next) => onChange(next as ChannelValue)}
        className="flex flex-wrap items-center gap-x-5 gap-y-2"
      >
        {options.map((option) => (
          <div key={option.value} className="flex items-center gap-2">
            <RadioGroupItem value={option.value} id={`${id}-${option.value}`} />
            <label
              htmlFor={`${id}-${option.value}`}
              className="cursor-pointer text-sm text-deepwater"
            >
              {option.label}
            </label>
          </div>
        ))}
      </RadioGroup>
    </div>
  );
}

export { ChannelSwitcher, type ChannelSwitcherProps, type ChannelValue };
