"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "@/components/ui/sonner";
import { Textarea } from "@/components/ui/textarea";
import { setServiceAreas, upsertPlan } from "@/server/actions/admin";
import type { ServiceAreaInput } from "@/server/schemas";
import type { CarrierOption } from "../../_lib/carriers";
import { parseDollarsToCents } from "./money";
import { TierChecklist } from "./tier-checklist";

const NEW_CARRIER = "__new__";

function parseCounties(text: string): ServiceAreaInput[] | "invalid" {
  const areas: ServiceAreaInput[] = [];
  for (const raw of text.split(/[\n,;]/)) {
    const entry = raw.trim();
    if (entry === "") continue;
    const match = entry.match(/^([A-Za-z]{2})[\s:/-]+(.+)$/);
    if (!match || !match[1] || !match[2]) return "invalid";
    areas.push({ state: match[1].toUpperCase(), county: match[2].trim() });
  }
  return areas;
}

export function AddPlanDialog({ carriers, year }: { carriers: CarrierOption[]; year: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [carrierChoice, setCarrierChoice] = useState(carriers.length > 0 ? "" : NEW_CARRIER);
  const [newCarrier, setNewCarrier] = useState("");
  const [name, setName] = useState("");
  const [contractPlanId, setContractPlanId] = useState("");
  const [premium, setPremium] = useState("");
  const [deductible, setDeductible] = useState("");
  const [deductibleTiers, setDeductibleTiers] = useState<number[]>([]);
  const [counties, setCounties] = useState("");
  const [isPending, startTransition] = useTransition();

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const carrierName = carrierChoice === NEW_CARRIER ? newCarrier.trim() : carrierChoice;
    if (!carrierName) {
      toast.error("Pick a carrier for this plan");
      return;
    }
    const premiumCents = parseDollarsToCents(premium);
    const rxDeductibleCents = parseDollarsToCents(deductible);
    if (Number.isNaN(premiumCents) || Number.isNaN(rxDeductibleCents)) {
      toast.error('Money fields take dollars — e.g. "0", "12.40", "$275"');
      return;
    }
    const areas = parseCounties(counties);
    if (areas === "invalid") {
      toast.error('Counties: one per line as "ST County" — e.g. "ID Ada"');
      return;
    }

    startTransition(async () => {
      const result = await upsertPlan({
        carrierName,
        planYear: year,
        name: name.trim(),
        contractPlanId: contractPlanId.trim() === "" ? null : contractPlanId.trim(),
        premiumCents,
        rxDeductibleCents,
        deductibleTiers,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      if (areas.length > 0) {
        const areasResult = await setServiceAreas(result.data.planId, areas);
        if (!areasResult.ok) {
          toast.error(`Plan saved, but service areas failed: ${areasResult.error}`);
        }
      }
      toast.success("Plan added to the catalog");
      setOpen(false);
      router.push(`/admin/plans?year=${year}&plan=${result.data.planId}`);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus />
          Add plan
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add plan</DialogTitle>
          <DialogDescription>
            The admin never creates plans by hand after an upload — plans arrive automatically
            with their formulary. Use this only for a plan the cover page missed.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label>Carrier</Label>
            {carriers.length > 0 ? (
              <Select value={carrierChoice} onValueChange={setCarrierChoice}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a carrier" />
                </SelectTrigger>
                <SelectContent>
                  {carriers.map((carrier) => (
                    <SelectItem key={carrier.id} value={carrier.name}>
                      {carrier.name}
                    </SelectItem>
                  ))}
                  <SelectItem value={NEW_CARRIER}>New carrier…</SelectItem>
                </SelectContent>
              </Select>
            ) : null}
            {carrierChoice === NEW_CARRIER ? (
              <Input
                placeholder="Carrier name"
                value={newCarrier}
                onChange={(event) => setNewCarrier(event.target.value)}
              />
            ) : null}
          </div>
          <div className="grid grid-cols-[1fr_10rem] gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="plan-name">Plan name</Label>
              <Input
                id="plan-name"
                required
                placeholder="e.g. True Blue Rx 33 (HMO)"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="plan-contract-id">Contract-plan ID</Label>
              <Input
                id="plan-contract-id"
                placeholder="H1350-033"
                className="text-data"
                value={contractPlanId}
                onChange={(event) => setContractPlanId(event.target.value)}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="plan-premium">Premium / mo ($)</Label>
              <Input
                id="plan-premium"
                inputMode="decimal"
                placeholder="0.00"
                className="text-data"
                value={premium}
                onChange={(event) => setPremium(event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="plan-deductible">Rx deductible ($)</Label>
              <Input
                id="plan-deductible"
                inputMode="decimal"
                placeholder="0.00"
                className="text-data"
                value={deductible}
                onChange={(event) => setDeductible(event.target.value)}
              />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Deductible applies to</Label>
            <TierChecklist value={deductibleTiers} onChange={setDeductibleTiers} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="plan-counties">Service-area counties</Label>
            <Textarea
              id="plan-counties"
              placeholder={"One per line: state county\nID Ada\nID Canyon\nID Blaine"}
              value={counties}
              onChange={(event) => setCounties(event.target.value)}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? "Adding…" : "Add plan"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
