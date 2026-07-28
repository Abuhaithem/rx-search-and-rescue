"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ChevronDown } from "lucide-react";
import type { PharmacyOption } from "@/server/queries/comparison";
import { setComparisonPharmacies } from "@/server/actions/analysis";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { toast } from "@/components/ui/sonner";
import { cn } from "@/lib/utils";

/** Choose which pharmacies the cost matrix prices (writes analysis_pharmacies). */
export function PharmacyPicker({
  analysisId,
  options,
  selectedIds,
  locked,
}: {
  analysisId: string;
  options: PharmacyOption[];
  selectedIds: string[];
  locked: boolean;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<string[]>(selectedIds);
  const [pending, startTransition] = useTransition();

  const commit = (next: string[]) => {
    const previous = selected;
    setSelected(next);
    startTransition(async () => {
      const result = await setComparisonPharmacies(analysisId, next);
      if (!result.ok) {
        setSelected(previous);
        toast.error(result.error);
        return;
      }
      router.refresh();
    });
  };

  const toggle = (id: string, on: boolean) =>
    commit(on ? [...selected, id] : selected.filter((x) => x !== id));

  const count = selected.length;
  const label = `${count} pharmac${count === 1 ? "y" : "ies"}`;

  if (locked) return <span className="text-xs text-steel">{label}</span>;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="secondary" size="sm" className={cn(pending && "opacity-60")}>
          Pharmacies ({count})
          <ChevronDown />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-0">
        <div className="border-b border-mist/60 px-3 py-2 text-eyebrow">Compare pharmacies</div>
        <div className="max-h-64 overflow-y-auto p-1">
          {options.length === 0 ? (
            <p className="px-2 py-3 text-sm text-steel">
              No pharmacies in the directory for this client&rsquo;s area yet.
            </p>
          ) : (
            options.map((option) => (
              <label
                key={option.id}
                className="flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 hover:bg-fog"
              >
                <Checkbox
                  checked={selected.includes(option.id)}
                  onCheckedChange={(v) => toggle(option.id, v === true)}
                  className="mt-0.5"
                />
                <span className="text-sm leading-tight">
                  <span className="font-medium text-deepwater">{option.name}</span>
                  {option.city ? (
                    <span className="block text-xs text-steel">
                      {option.city}
                      {option.state ? `, ${option.state}` : ""}
                    </span>
                  ) : null}
                </span>
              </label>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
