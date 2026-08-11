"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { Search } from "lucide-react";
import type { ComparablePharmacies } from "@/server/queries/comparison";
import { setComparisonPharmacies } from "@/server/actions/analysis";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { NetworkStatusChip } from "@/components/domain/network-status-chip";
import { toast } from "@/components/ui/sonner";
import { cn } from "@/lib/utils";

const MAX_PHARMACIES = 6;
const FILTER_THRESHOLD = 9;

/**
 * Pharmacy selection as cards — the same grammar as plan selection: the whole
 * card is clickable, selection is a checkbox + harbor ring, and each card
 * wears its preferred/standard status per compared plan. Choosing a pharmacy
 * immediately re-prices the cost matrix below.
 */
export function PharmacyCards({
  analysisId,
  choices,
}: {
  analysisId: string;
  choices: ComparablePharmacies;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<string[]>(choices.selectedIds);
  const [filter, setFilter] = useState("");
  const [pending, startTransition] = useTransition();

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (q === "") return choices.options;
    return choices.options.filter(
      (o) =>
        o.name.toLowerCase().includes(q) ||
        (o.city ?? "").toLowerCase().includes(q) ||
        (o.zip ?? "").includes(q),
    );
  }, [choices.options, filter]);

  const toggle = (pharmacyId: string) => {
    if (choices.locked) return;
    const isSelected = selected.includes(pharmacyId);
    if (!isSelected && selected.length >= MAX_PHARMACIES) {
      toast.error(`Compare up to ${MAX_PHARMACIES} pharmacies`);
      return;
    }
    const next = isSelected
      ? selected.filter((id) => id !== pharmacyId)
      : [...selected, pharmacyId];
    setSelected(next);
    startTransition(async () => {
      const result = await setComparisonPharmacies(analysisId, next);
      if (!result.ok) {
        toast.error(result.error);
        setSelected(selected); // revert
        return;
      }
      router.refresh();
    });
  };

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-lg text-deepwater">Pharmacies</h2>
          <p className="text-xs text-steel">
            Pick up to <span className="text-data">{MAX_PHARMACIES}</span> —{" "}
            <span className="text-data">{selected.length}</span> selected. Each card shows the
            pharmacy&apos;s standing on every compared plan.
          </p>
        </div>
        {choices.options.length > FILTER_THRESHOLD ? (
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-steel" />
            <Input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter by name, city, ZIP…"
              className="w-64 pl-8"
            />
          </div>
        ) : null}
      </div>

      {visible.length === 0 ? (
        <p className="rounded-card border border-dashed border-mist bg-white px-6 py-8 text-center text-sm text-steel">
          {choices.options.length === 0
            ? "No pharmacies on file yet — they arrive from carrier directory uploads and client intakes."
            : `No pharmacies match “${filter.trim()}”.`}
        </p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {visible.map((pharmacy) => {
            const isSelected = selected.includes(pharmacy.id);
            const disabled =
              choices.locked || (!isSelected && selected.length >= MAX_PHARMACIES);
            return (
              <label
                key={pharmacy.id}
                data-selected={isSelected || undefined}
                className={cn(
                  "block cursor-pointer rounded-card border bg-white p-4 shadow-card transition-colors",
                  isSelected ? "border-harbor ring-1 ring-harbor" : "border-mist/80",
                  disabled && !isSelected
                    ? "cursor-not-allowed opacity-60"
                    : "hover:border-steel/60",
                )}
              >
                <div className="flex items-start gap-3">
                  <Checkbox
                    checked={isSelected}
                    disabled={disabled && !isSelected}
                    onCheckedChange={() => toggle(pharmacy.id)}
                    className="mt-0.5"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold leading-tight text-deepwater">
                      {pharmacy.name}
                    </div>
                    <div className="text-xs text-steel">
                      {[pharmacy.city, pharmacy.state].filter(Boolean).join(", ")}
                      {pharmacy.zip ? (
                        <>
                          {" "}
                          · <span className="text-data">{pharmacy.zip}</span>
                        </>
                      ) : null}
                    </div>
                  </div>
                </div>
                <div className="mt-3 space-y-1.5">
                  {choices.plans.map((plan) => (
                    <div key={plan.id} className="flex items-center justify-between gap-2">
                      <span className="truncate text-xs text-steel">{plan.name}</span>
                      <NetworkStatusChip
                        status={pharmacy.statusByPlan[plan.id] ?? null}
                        className="shrink-0"
                      />
                    </div>
                  ))}
                </div>
              </label>
            );
          })}
        </div>
      )}
      {choices.locked ? (
        <p className="text-xs text-steel">
          Pharmacy selection is locked — this analysis is approved.
        </p>
      ) : pending ? (
        <p className="text-xs text-steel">Re-pricing…</p>
      ) : null}
    </section>
  );
}
