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

/**
 * People type what the document says: "up to 35", "$35", "1,200.50".
 * Extract the number from whatever surrounds it; empty = "not set".
 */
const dollarsToCents = (value: string): number | null | "invalid" => {
  if (value.trim() === "") return null;
  const match = value.replace(/,/g, "").match(/\d+(?:\.\d+)?/);
  if (!match) return "invalid";
  return Math.round(Number(match[0]) * 100);
};

/** "25", "25%", "about 25 %" → 25. */
const parsePercent = (value: string): number | null | "invalid" => {
  if (value.trim() === "") return null;
  const match = value.match(/\d+(?:\.\d+)?/);
  if (!match) return "invalid";
  const parsed = Number(match[0]);
  return parsed >= 0 && parsed <= 100 ? parsed : "invalid";
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
  const [days, setDays] = useState(String(cost.daysSupply));
  const [pending, startTransition] = useTransition();

  const save = () => {
    const copayCents = dollarsToCents(copay);
    const coinsurancePct = parsePercent(coinsurance);
    const capCents = dollarsToCents(cap);
    if (copayCents === "invalid" || capCents === "invalid") {
      toast.error("Enter dollar amounts as plain numbers, e.g. 35 or 35.50");
      return;
    }
    if (coinsurancePct === "invalid") {
      toast.error("Enter the coinsurance as a number between 0 and 100, e.g. 25");
      return;
    }
    const capOnly = copayCents === null && coinsurancePct === null && capCents !== null;
    if (!capOnly && (copayCents !== null) === (coinsurancePct !== null)) {
      toast.error('Fill a copay, a coinsurance percentage, or only the cap ("up to $X")');
      return;
    }
    const daysSupply = Number((days.match(/\d+/) ?? [])[0]);
    if (!Number.isInteger(daysSupply) || daysSupply < 1 || daysSupply > 365) {
      toast.error("Days supply is the fill length from the document — e.g. 30, 90, 100");
      return;
    }
    startTransition(async () => {
      const result = await updateStagedTierCost(cost.id, {
        copayCents,
        coinsurancePct,
        maxCents: capCents,
        daysSupply,
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
            <div className="grid grid-cols-2 gap-4">
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
              <div className="space-y-1.5">
                <Label htmlFor="staged-days">Days supply</Label>
                <Input
                  id="staged-days"
                  className="text-data"
                  inputMode="numeric"
                  placeholder="e.g. 30, 90, 100"
                  value={days}
                  onChange={(e) => setDays(e.target.value)}
                />
              </div>
            </div>
            <p className="text-xs text-steel">
              Fill a copay OR a coinsurance — or the cap alone when the document says just
              &ldquo;up to $X&rdquo;. If the cell is N/A, remove the row instead.
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
