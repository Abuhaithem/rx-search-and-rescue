"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { Loader2, Pencil, Search, Trash2 } from "lucide-react";
import {
  deleteAllPharmacies,
  deletePharmacy,
  updatePharmacy,
  type PharmacyPatch,
} from "@/server/actions/pharmacies";
import { TypeToConfirmDeleteDialog } from "@/components/domain/type-to-confirm-delete-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TBody, TCell, TH, THead, TRow } from "@/components/ui/table";
import { toast } from "@/components/ui/sonner";

export interface PharmacyTableRow {
  id: string;
  name: string;
  brandName: string | null;
  address1: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  source: string;
}

const VISIBLE_STEP = 150;

export function PharmacyTable({
  rows,
  stateCounts,
}: {
  rows: PharmacyTableRow[];
  /** Per-state totals; null state = rows with no state set. */
  stateCounts: { state: string | null; count: number }[];
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [stateFilter, setStateFilter] = useState<string | null | "all">("all");
  const [visibleCount, setVisibleCount] = useState(VISIBLE_STEP);
  const [editing, setEditing] = useState<PharmacyTableRow | null>(null);
  const [removing, setRemoving] = useState<PharmacyTableRow | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (stateFilter !== "all" && r.state !== stateFilter) return false;
      if (q === "") return true;
      return (
        r.name.toLowerCase().includes(q) ||
        (r.brandName ?? "").toLowerCase().includes(q) ||
        (r.city ?? "").toLowerCase().includes(q) ||
        (r.state ?? "").toLowerCase() === q ||
        (r.zip ?? "").includes(q)
      );
    });
  }, [rows, query, stateFilter]);
  const visible = filtered.slice(0, visibleCount);

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="font-display text-base font-extrabold text-deepwater">
          Master list (<span className="text-data">{rows.length.toLocaleString()}</span>)
        </h2>
        <div className="ml-auto flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-steel" />
            <Input
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setVisibleCount(VISIBLE_STEP);
              }}
              placeholder="Filter by name, brand, city, state, or ZIP…"
              className="w-72 pl-8"
            />
          </div>
          {rows.length > 0 ? <DeleteAllButton total={rows.length} /> : null}
        </div>
      </div>

      {stateCounts.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => {
              setStateFilter("all");
              setVisibleCount(VISIBLE_STEP);
            }}
            className={`rounded-chip px-2.5 py-1 font-mono text-[11px] font-semibold uppercase tracking-[0.08em] transition-colors ${
              stateFilter === "all"
                ? "bg-harbor text-white"
                : "bg-fog text-steel hover:bg-mist/60"
            }`}
          >
            All states
          </button>
          {stateCounts.map((entry) => (
            <button
              key={entry.state ?? "none"}
              type="button"
              onClick={() => {
                setStateFilter(entry.state);
                setVisibleCount(VISIBLE_STEP);
              }}
              className={`rounded-chip px-2.5 py-1 font-mono text-[11px] font-semibold uppercase tracking-[0.08em] transition-colors ${
                stateFilter === entry.state
                  ? "bg-harbor text-white"
                  : "bg-fog text-steel hover:bg-mist/60"
              }`}
            >
              {entry.state ?? "No state"} · {entry.count.toLocaleString()}
            </button>
          ))}
        </div>
      ) : null}

      {filtered.length === 0 ? (
        <p className="rounded-card border border-dashed border-mist bg-white px-6 py-8 text-center text-sm text-steel">
          {rows.length === 0
            ? "No pharmacies yet — upload a roster PDF or paste a list above."
            : `No pharmacies match “${query.trim()}”.`}
        </p>
      ) : (
        <div className="rounded-card border border-mist/60 bg-white shadow-card">
          <Table>
            <THead>
              <TRow>
                <TH>Pharmacy</TH>
                <TH>Brand</TH>
                <TH>Address</TH>
                <TH>City</TH>
                <TH className="w-16">State</TH>
                <TH className="w-20">ZIP</TH>
                <TH className="w-24">Source</TH>
                <TH className="w-24" aria-label="Actions" />
              </TRow>
            </THead>
            <TBody>
              {visible.map((row) => (
                <TRow key={row.id} className="hover:bg-transparent">
                  <TCell className="text-sm font-semibold text-deepwater">{row.name}</TCell>
                  <TCell className="text-sm text-steel">{row.brandName ?? "—"}</TCell>
                  <TCell className="text-sm text-steel">{row.address1 ?? "—"}</TCell>
                  <TCell className="text-sm text-steel">{row.city ?? "—"}</TCell>
                  <TCell className="text-data text-sm">{row.state ?? "—"}</TCell>
                  <TCell className="text-data text-sm">{row.zip ?? "—"}</TCell>
                  <TCell className="font-mono text-[11px] uppercase tracking-[0.08em] text-steel">
                    {row.source}
                  </TCell>
                  <TCell>
                    <div className="flex items-center gap-0.5">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        aria-label={`Edit ${row.name}`}
                        onClick={() => setEditing(row)}
                      >
                        <Pencil className="size-3.5" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        aria-label={`Delete ${row.name}`}
                        className="text-notcovered hover:bg-notcovered-soft hover:text-notcovered"
                        onClick={() => setRemoving(row)}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  </TCell>
                </TRow>
              ))}
            </TBody>
          </Table>
          {filtered.length > visibleCount ? (
            <div className="border-t border-mist/55 px-4 py-2.5">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setVisibleCount((n) => n + VISIBLE_STEP)}
              >
                Show {Math.min(VISIBLE_STEP, filtered.length - visibleCount).toLocaleString()} more
              </Button>
            </div>
          ) : null}
        </div>
      )}

      {editing ? (
        <EditPharmacyDialog
          key={editing.id}
          row={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            router.refresh();
          }}
        />
      ) : null}

      {removing ? (
        <DeletePharmacyDialog
          key={removing.id}
          row={removing}
          onClose={() => setRemoving(null)}
          onDeleted={() => {
            setRemoving(null);
            router.refresh();
          }}
        />
      ) : null}
    </section>
  );
}

function DeleteAllButton({ total }: { total: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const wipe = () => {
    startTransition(async () => {
      const result = await deleteAllPharmacies();
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(
        `${result.data.pharmacies.toLocaleString()} pharmacies and ${result.data.brands.toLocaleString()} brands removed`,
      );
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
        className="text-notcovered hover:bg-notcovered-soft hover:text-notcovered"
        onClick={() => setOpen(true)}
      >
        <Trash2 className="size-3.5" />
        Delete all
      </Button>
      <TypeToConfirmDeleteDialog
        open={open}
        onOpenChange={setOpen}
        title="Delete the entire pharmacy list?"
        confirmName="delete all pharmacies"
        pending={pending}
        onConfirm={wipe}
      >
        <p>
          All <span className="text-data font-semibold">{total.toLocaleString()}</span>{" "}
          pharmacies and their brands leave the system — every carrier and plan network row goes
          with them, and client pharmacy links revert to unlinked text for re-matching. This is
          the fresh-start reset before a clean roster import. It cannot be undone.
        </p>
      </TypeToConfirmDeleteDialog>
    </>
  );
}

function EditPharmacyDialog({
  row,
  onClose,
  onSaved,
}: {
  row: PharmacyTableRow;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(row.name);
  const [brand, setBrand] = useState(row.brandName ?? "");
  const [address1, setAddress1] = useState(row.address1 ?? "");
  const [city, setCity] = useState(row.city ?? "");
  const [state, setState] = useState(row.state ?? "");
  const [zip, setZip] = useState(row.zip ?? "");
  const [isPending, startTransition] = useTransition();

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (zip.trim() !== "" && !/^\d{5}$/.test(zip.trim())) {
      toast.error("ZIP must be 5 digits (or empty)");
      return;
    }
    if (state.trim() !== "" && !/^[A-Za-z]{2}$/.test(state.trim())) {
      toast.error("State is the 2-letter code (or empty)");
      return;
    }
    const patch: PharmacyPatch = {
      name: name.trim(),
      brand: brand.trim() || name.trim(),
      address1: address1.trim() || null,
      city: city.trim() || null,
      state: state.trim() ? state.trim().toUpperCase() : null,
      zip: zip.trim() || null,
    };
    startTransition(async () => {
      const result = await updatePharmacy(row.id, patch);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Pharmacy saved");
      onSaved();
    });
  }

  return (
    <Dialog open onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit pharmacy</DialogTitle>
          <DialogDescription>
            Changes apply everywhere this location is referenced — networks, pickers, and
            client links.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ph-name">Name</Label>
              <Input id="ph-name" required value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ph-brand">Brand</Label>
              <Input
                id="ph-brand"
                placeholder="Chain the location belongs to"
                value={brand}
                onChange={(e) => setBrand(e.target.value)}
              />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ph-address">Address</Label>
            <Input id="ph-address" value={address1} onChange={(e) => setAddress1(e.target.value)} />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ph-city">City</Label>
              <Input id="ph-city" value={city} onChange={(e) => setCity(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ph-state">State</Label>
              <Input
                id="ph-state"
                maxLength={2}
                className="text-data uppercase"
                value={state}
                onChange={(e) => setState(e.target.value.toUpperCase())}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ph-zip">ZIP</Label>
              <Input
                id="ph-zip"
                inputMode="numeric"
                maxLength={5}
                className="text-data"
                value={zip}
                onChange={(e) => setZip(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? <Loader2 className="animate-spin" /> : null}
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DeletePharmacyDialog({
  row,
  onClose,
  onDeleted,
}: {
  row: PharmacyTableRow;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [isPending, startTransition] = useTransition();

  const remove = () => {
    startTransition(async () => {
      const result = await deletePharmacy(row.id);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Pharmacy removed");
      onDeleted();
    });
  };

  return (
    <Dialog open onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Remove this pharmacy?</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-steel">
          “{row.name}”{row.zip ? ` (${row.zip})` : ""} leaves the master list. Its carrier and
          plan network rows are removed with it, and any client links revert to unlinked text
          for the agent to re-match. This cannot be undone.
        </p>
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={onClose}>
            Keep it
          </Button>
          <Button type="button" variant="destructive" onClick={remove} disabled={isPending}>
            {isPending ? <Loader2 className="animate-spin" /> : <Trash2 className="size-4" />}
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
