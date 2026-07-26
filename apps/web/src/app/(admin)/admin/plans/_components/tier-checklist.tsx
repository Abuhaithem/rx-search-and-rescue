"use client";

import { Checkbox } from "@/components/ui/checkbox";

const TIER_NUMBERS = [1, 2, 3, 4, 5, 6] as const;

/** "Deductible applies to" multi-select: T1–T6 checkboxes with mono labels. */
export function TierChecklist({
  value,
  onChange,
}: {
  value: number[];
  onChange: (next: number[]) => void;
}) {
  return (
    <div className="flex h-9 items-center gap-3">
      {TIER_NUMBERS.map((tier) => (
        <label key={tier} className="flex items-center gap-1 font-mono text-xs text-deepwater">
          <Checkbox
            checked={value.includes(tier)}
            onCheckedChange={(checked) =>
              onChange(
                checked === true
                  ? [...value, tier].sort((a, b) => a - b)
                  : value.filter((t) => t !== tier),
              )
            }
          />
          T{tier}
        </label>
      ))}
    </div>
  );
}
