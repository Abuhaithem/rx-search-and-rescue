"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { Loader2, Pencil, Plus, Search, Trash2 } from "lucide-react";
import {
  addFormularyEntry,
  deleteFormularyEntry,
  updateFormularyEntry,
} from "@/server/actions/admin";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
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
import type { FormularyEntryRow } from "@/server/queries/plan-workspace";

const TIERS = [1, 2, 3, 4, 5, 6];

/** Debounced server-driven search box (URL param → server component refetch). */
export function EntrySearch({ basePath, q, reviewOnly }: { basePath: string; q: string; reviewOnly: boolean }) {
  const router = useRouter();
  const [value, setValue] = useState(q);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const push = (nextQ: string, nextReviewOnly: boolean) => {
    const params = new URLSearchParams();
    if (nextQ.trim() !== "") params.set("q", nextQ.trim());
    if (nextReviewOnly) params.set("review", "1");
    router.replace(`${basePath}${params.size > 0 ? `&${params}` : ""}`);
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-steel" />
        <Input
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            if (timer.current) clearTimeout(timer.current);
            const next = e.target.value;
            timer.current = setTimeout(() => push(next, reviewOnly), 300);
          }}
          placeholder="Search this plan's drug list…"
          className="w-72 pl-8"
        />
      </div>
      <Button
        type="button"
        variant={reviewOnly ? "primary" : "secondary"}
        size="sm"
        onClick={() => push(value, !reviewOnly)}
      >
        Needs review only
      </Button>
    </div>
  );
}

interface EntryFormState {
  rawDrugName: string;
  tier: number;
  rawRequirementsText: string;
}

function EntryFields({
  state,
  onChange,
}: {
  state: EntryFormState;
  onChange: (next: EntryFormState) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="entry-name">Drug name (as printed)</Label>
        <Input
          id="entry-name"
          value={state.rawDrugName}
          onChange={(e) => onChange({ ...state, rawDrugName: e.target.value })}
          required
        />
        <p className="text-xs text-steel">lowercase = generic · UPPERCASE = brand</p>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label>Tier</Label>
          <Select
            value={String(state.tier)}
            onValueChange={(v) => onChange({ ...state, tier: Number(v) })}
          >
            <SelectTrigger className="text-data">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TIERS.map((tier) => (
                <SelectItem key={tier} value={String(tier)} className="text-data">
                  Tier {tier}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="entry-req">Requirements</Label>
          <Input
            id="entry-req"
            value={state.rawRequirementsText}
            onChange={(e) => onChange({ ...state, rawRequirementsText: e.target.value })}
            placeholder="PA; QL (60 per 30 days)"
          />
        </div>
      </div>
    </div>
  );
}

export function EditEntryDialog({ entry }: { entry: FormularyEntryRow }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<EntryFormState>({
    rawDrugName: entry.rawDrugName,
    tier: entry.tier,
    rawRequirementsText: entry.rawRequirementsText ?? "",
  });
  const [pending, startTransition] = useTransition();

  const save = () => {
    startTransition(async () => {
      const result = await updateFormularyEntry(entry.id, {
        rawDrugName: state.rawDrugName,
        tier: state.tier,
        rawRequirementsText: state.rawRequirementsText.trim() || null,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Entry updated");
      setOpen(false);
      router.refresh();
    });
  };

  const remove = () => {
    startTransition(async () => {
      const result = await deleteFormularyEntry(entry.id);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Entry removed");
      setOpen(false);
      router.refresh();
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" aria-label={`Edit ${entry.rawDrugName}`}>
          <Pencil className="size-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Edit drug entry</DialogTitle>
        </DialogHeader>
        <EntryFields state={state} onChange={setState} />
        <DialogFooter className="flex items-center justify-between sm:justify-between">
          <Button type="button" variant="destructive" size="sm" onClick={remove} disabled={pending}>
            <Trash2 className="size-4" /> Remove
          </Button>
          <Button type="button" onClick={save} disabled={pending || state.rawDrugName.trim() === ""}>
            {pending ? <Loader2 className="animate-spin" /> : null}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function AddEntryDialog({ formularyId }: { formularyId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<EntryFormState>({
    rawDrugName: "",
    tier: 1,
    rawRequirementsText: "",
  });
  const [pending, startTransition] = useTransition();

  const save = () => {
    startTransition(async () => {
      const result = await addFormularyEntry(formularyId, {
        rawDrugName: state.rawDrugName,
        tier: state.tier,
        rawRequirementsText: state.rawRequirementsText.trim() || null,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`${state.rawDrugName.trim()} added`);
      setOpen(false);
      setState({ rawDrugName: "", tier: 1, rawRequirementsText: "" });
      router.refresh();
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="secondary" size="sm">
          <Plus className="size-4" /> Add drug
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add drug entry</DialogTitle>
        </DialogHeader>
        <EntryFields state={state} onChange={setState} />
        <DialogFooter>
          <Button type="button" onClick={save} disabled={pending || state.rawDrugName.trim() === ""}>
            {pending ? <Loader2 className="animate-spin" /> : null}
            Add to list
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
