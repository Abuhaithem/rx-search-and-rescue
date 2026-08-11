"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Loader2, Pencil, Trash2 } from "lucide-react";
import { deleteStagedTierCost, updateStagedTierCost } from "@/server/actions/wizard";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/sonner";
import type { WizardStagedTierCost } from "@/server/queries/wizard";

const centsToDollars = (cents: number | null): string =>
  cents === null ? "" : (cents / 100).toFixed(2).replace(/\.00$/, "");

const dollarsToCents = (value: string): number | null => {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed * 100) : null;
};

/** In-place correction on the SoB preview — the preview IS the editor. */
export function EditStagedCostDialog({
  cost,
  rowLabel,
}: {
  cost: WizardStagedTierCost;
  rowLabel: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [copay, setCopay] = useState(centsToDollars(cost.copayCents));
  const [coinsurance, setCoinsurance] = useState(
    cost.coinsurancePct === null ? "" : String(cost.coinsurancePct),
  );
  const [cap, setCap] = useState(centsToDollars(cost.maxCents));
  const [pending, startTransition] = useTransition();

  const save = () => {
    const copayCents = dollarsToCents(copay);
    const coinsurancePct = coinsurance.trim() === "" ? null : Number(coinsurance);
    if ((copayCents !== null) === (coinsurancePct !== null)) {
      toast.error("Fill exactly one: a copay amount OR a coinsurance percentage");
      return;
    }
    startTransition(async () => {
      const result = await updateStagedTierCost(cost.id, {
        copayCents,
        coinsurancePct,
        maxCents: dollarsToCents(cap),
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`${rowLabel} corrected`);
      setOpen(false);
      router.refresh();
    });
  };

  const remove = () => {
    startTransition(async () => {
      const result = await deleteStagedTierCost(cost.id);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`${rowLabel} removed`);
      setOpen(false);
      router.refresh();
    });
  };

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        aria-label={`Edit ${rowLabel}`}
        onClick={() => setOpen(true)}
      >
        <Pencil className="size-4" />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Correct {rowLabel}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="staged-copay">Copay ($)</Label>
                <Input
                  id="staged-copay"
                  className="text-data"
                  inputMode="decimal"
                  placeholder="e.g. 47"
                  value={copay}
                  onChange={(e) => setCopay(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="staged-coins">Coinsurance (%)</Label>
                <Input
                  id="staged-coins"
                  className="text-data"
                  inputMode="decimal"
                  placeholder="e.g. 25"
                  value={coinsurance}
                  onChange={(e) => setCoinsurance(e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="staged-cap">Per-fill cap ($, optional)</Label>
              <Input
                id="staged-cap"
                className="text-data"
                inputMode="decimal"
                placeholder='e.g. 35 for "25% up to $35"'
                value={cap}
                onChange={(e) => setCap(e.target.value)}
              />
            </div>
            <p className="text-xs text-steel">
              Fill exactly one of copay or coinsurance. If the document marks this cell N/A,
              remove the row instead.
            </p>
          </div>
          <DialogFooter className="flex items-center justify-between sm:justify-between">
            <Button type="button" variant="destructive" size="sm" onClick={remove} disabled={pending}>
              <Trash2 className="size-4" /> Remove row
            </Button>
            <Button type="button" onClick={save} disabled={pending}>
              {pending ? <Loader2 className="animate-spin" /> : null}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
