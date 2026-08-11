"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Loader2, Plus, Upload, X } from "lucide-react";
import {
  approveFormularyPreview,
  finalizeFormularyWizard,
  startFormularyWizard,
  uploadSummaryOfBenefits,
} from "@/server/actions/wizard";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { CarrierLogo } from "@/components/domain/carrier-logo";
import { fileTooLarge, MAX_PDF_BYTES } from "@/lib/file-limits";

interface CarrierOption {
  id: string;
  name: string;
  logoUrl: string | null;
}

// ─── Step 1 ──────────────────────────────────────────────────────────────────

export function StepUploadForm({
  carriers,
  years,
  defaultYear,
}: {
  carriers: CarrierOption[];
  years: number[];
  defaultYear: number;
}) {
  const router = useRouter();
  const [carrierId, setCarrierId] = useState("");
  const [pending, startTransition] = useTransition();

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    formData.set("carrierId", carrierId);
    const sizeError = fileTooLarge(formData.get("pdf") as File | null, MAX_PDF_BYTES);
    if (sizeError) {
      toast.error(sizeError);
      return;
    }
    startTransition(async () => {
      const result = await startFormularyWizard(formData);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Formulary uploaded — extraction is running");
      router.push(`/admin/formularies/upload?formulary=${result.data.formularyId}&step=2`);
    });
  };

  const selected = carriers.find((c) => c.id === carrierId);

  return (
    <form onSubmit={submit} className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label>Carrier</Label>
          <Select value={carrierId} onValueChange={setCarrierId}>
            <SelectTrigger>
              <SelectValue placeholder="Select a carrier">
                {selected ? (
                  <span className="flex items-center gap-2">
                    <CarrierLogo name={selected.name} logoUrl={selected.logoUrl} size={20} />
                    {selected.name}
                  </span>
                ) : undefined}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {carriers.map((carrier) => (
                <SelectItem key={carrier.id} value={carrier.id}>
                  <span className="flex items-center gap-2">
                    <CarrierLogo name={carrier.name} logoUrl={carrier.logoUrl} size={20} />
                    {carrier.name}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-steel">
            Missing a carrier?{" "}
            <Link href="/admin/carriers" className="font-semibold text-harbor hover:underline">
              Create it first →
            </Link>
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="wizard-year">Plan year</Label>
          <Select name="planYear" defaultValue={String(defaultYear)}>
            <SelectTrigger id="wizard-year" className="text-data">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {years.map((year) => (
                <SelectItem key={year} value={String(year)} className="text-data">
                  {year}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="wizard-pdf">Formulary PDF</Label>
        <Input id="wizard-pdf" name="pdf" type="file" accept=".pdf,application/pdf" required />
        <p className="text-xs text-steel">
          The plan names and the full drug list are read from the document — no manual entry.
        </p>
      </div>
      <Button type="submit" disabled={pending || carrierId === ""}>
        {pending ? <Loader2 className="animate-spin" /> : <Upload className="size-4" />}
        Upload &amp; extract
      </Button>
    </form>
  );
}

// ─── Step 2: plan names + approve ────────────────────────────────────────────

export function PlanNamesApprove({
  formularyId,
  initialNames,
  disabled,
}: {
  formularyId: string;
  initialNames: string[];
  disabled: boolean;
}) {
  const router = useRouter();
  const [names, setNames] = useState<string[]>(initialNames.length > 0 ? initialNames : [""]);
  const [pending, startTransition] = useTransition();

  const approve = () => {
    startTransition(async () => {
      const result = await approveFormularyPreview(formularyId, names);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`${result.data.planIds.length} plans linked`);
      router.push(`/admin/formularies/upload?formulary=${formularyId}&step=3`);
    });
  };

  return (
    <div className="space-y-3">
      <p className="text-eyebrow">Plans this formulary applies to</p>
      <div className="space-y-2">
        {names.map((name, index) => (
          <div key={index} className="flex items-center gap-2">
            <Input
              value={name}
              onChange={(e) =>
                setNames((all) => all.map((n, i) => (i === index ? e.target.value : n)))
              }
              placeholder="True Blue Rx 33 (HMO)"
              className="max-w-md"
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label="Remove plan"
              onClick={() => setNames((all) => all.filter((_, i) => i !== index))}
            >
              <X className="size-4" />
            </Button>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-3">
        <Button type="button" variant="secondary" size="sm" onClick={() => setNames((all) => [...all, ""])}>
          <Plus className="size-4" /> Add plan
        </Button>
        <Button
          type="button"
          onClick={approve}
          disabled={pending || disabled || names.every((n) => n.trim() === "")}
        >
          {pending ? <Loader2 className="animate-spin" /> : null}
          Approve formulary &amp; continue →
        </Button>
      </div>
      {disabled ? (
        <p className="text-xs font-semibold text-restricted">
          Resolve the flagged extraction rows before approving.
        </p>
      ) : null}
    </div>
  );
}

// ─── Step 3: SoB upload ──────────────────────────────────────────────────────

export function SobUploadForm({
  formularyId,
  plans,
}: {
  formularyId: string;
  plans: { id: string; name: string; sobPath: string | null }[];
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(
    new Set(plans.filter((p) => !p.sobPath).map((p) => p.id)),
  );
  const [pending, startTransition] = useTransition();

  const toggle = (planId: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(planId)) next.delete(planId);
      else next.add(planId);
      return next;
    });
  };

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const sizeError = fileTooLarge(formData.get("pdf") as File | null, MAX_PDF_BYTES);
    if (sizeError) {
      toast.error(sizeError);
      return;
    }
    startTransition(async () => {
      const result = await uploadSummaryOfBenefits(formularyId, [...selected], formData);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Summary of Benefits queued — cost sharing is being extracted");
      router.refresh();
    });
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="space-y-2">
        <p className="text-eyebrow">This document covers</p>
        {plans.map((plan) => (
          <label key={plan.id} className="flex items-center gap-2 text-sm text-deepwater">
            <Checkbox checked={selected.has(plan.id)} onCheckedChange={() => toggle(plan.id)} />
            {plan.name}
            {plan.sobPath ? (
              <span className="rounded-chip bg-covered-soft px-2 py-0.5 text-xs font-semibold text-covered">
                SoB attached ✓
              </span>
            ) : null}
          </label>
        ))}
        <p className="text-xs text-steel">
          One SBC covering several plans? Tick them all — each plan&apos;s own column is read.
        </p>
      </div>
      <div className="flex items-end gap-3">
        <div className="flex-1 space-y-1.5">
          <Label htmlFor="sob-pdf">Summary of Benefits PDF</Label>
          <Input id="sob-pdf" name="pdf" type="file" accept=".pdf,application/pdf" required />
        </div>
        <Button type="submit" disabled={pending || selected.size === 0}>
          {pending ? <Loader2 className="animate-spin" /> : <Upload className="size-4" />}
          Extract cost sharing
        </Button>
      </div>
    </form>
  );
}

// ─── Step 5: finalize ────────────────────────────────────────────────────────

export function FinalizeButton({
  formularyId,
  planYear,
}: {
  formularyId: string;
  planYear: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const finalize = () => {
    startTransition(async () => {
      const result = await finalizeFormularyWizard(formularyId);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Formulary activated — everything is live");
      router.push(`/admin/carriers?year=${planYear}`);
    });
  };

  return (
    <Button type="button" variant="rescue" onClick={finalize} disabled={pending}>
      {pending ? <Loader2 className="animate-spin" /> : null}
      Finalize &amp; activate
    </Button>
  );
}
