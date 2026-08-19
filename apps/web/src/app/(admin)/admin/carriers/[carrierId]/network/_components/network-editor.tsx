"use client";

import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, useTransition } from "react";
import { Loader2, Plus, Search, Trash2 } from "lucide-react";
import type { NetworkStatus } from "@rxsr/core";
import {
  removeCarrierPharmacyRows,
  setCarrierPharmacyStatus,
  setCarrierPharmacyStatusBulk,
} from "@/server/actions/admin";
import { searchPharmacies, type PharmacySearchHit } from "@/server/actions/pharmacies";
import { NetworkStatusChip } from "@/components/domain/network-status-chip";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Table, TBody, TCell, TH, THead, TRow } from "@/components/ui/table";
import { toast } from "@/components/ui/sonner";
import { cn } from "@/lib/utils";
import type { CarrierNetworkEditorRow } from "../../../../_lib/pharmacies";

const VISIBLE_STEP = 150;

const STATUS_OPTIONS: { value: NetworkStatus; label: string }[] = [
  { value: "preferred", label: "Preferred" },
  { value: "standard", label: "Standard" },
  { value: "out_of_network", label: "Not in network" },
];

const STATUS_LABEL: Record<NetworkStatus, string> = {
  preferred: "Preferred",
  standard: "Standard",
  out_of_network: "Not in network",
};

export function NetworkEditor({
  carrierId,
  planYear,
  rows,
}: {
  carrierId: string;
  planYear: number;
  rows: CarrierNetworkEditorRow[];
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<NetworkStatus | "all">("all");
  const [sourceFilter, setSourceFilter] = useState<string | "all">("all");
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [visibleCount, setVisibleCount] = useState(VISIBLE_STEP);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [bulkPending, startBulk] = useTransition();
  const [, startRow] = useTransition();
  const [addOpen, setAddOpen] = useState(false);

  const statusCounts = useMemo(() => {
    const counts = new Map<NetworkStatus, number>();
    for (const row of rows) counts.set(row.status, (counts.get(row.status) ?? 0) + 1);
    return counts;
  }, [rows]);
  const sourceCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of rows) counts.set(row.source, (counts.get(row.source) ?? 0) + 1);
    return counts;
  }, [rows]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((row) => {
      if (statusFilter !== "all" && row.status !== statusFilter) return false;
      if (sourceFilter !== "all" && row.source !== sourceFilter) return false;
      if (q === "") return true;
      return (
        row.name.toLowerCase().includes(q) ||
        (row.brandName ?? "").toLowerCase().includes(q) ||
        (row.city ?? "").toLowerCase().includes(q) ||
        (row.zip ?? "").includes(q)
      );
    });
  }, [rows, query, statusFilter, sourceFilter]);
  const visible = filtered.slice(0, visibleCount);
  const allFilteredSelected =
    filtered.length > 0 && filtered.every((row) => selected.has(row.pharmacyId));

  const resetPaging = () => setVisibleCount(VISIBLE_STEP);

  function toggleAllFiltered() {
    setSelected((prev) => {
      if (allFilteredSelected) {
        const next = new Set(prev);
        for (const row of filtered) next.delete(row.pharmacyId);
        return next;
      }
      return new Set([...prev, ...filtered.map((row) => row.pharmacyId)]);
    });
  }

  function setOneStatus(pharmacyId: string, status: NetworkStatus) {
    setPendingId(pharmacyId);
    startRow(async () => {
      const result = await setCarrierPharmacyStatus(carrierId, planYear, pharmacyId, status);
      setPendingId(null);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      router.refresh();
    });
  }

  function bulkStatus(status: NetworkStatus) {
    startBulk(async () => {
      const result = await setCarrierPharmacyStatusBulk(
        carrierId,
        planYear,
        [...selected],
        status,
      );
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`${result.data.count.toLocaleString()} set to ${STATUS_LABEL[status]}`);
      setSelected(new Set());
      router.refresh();
    });
  }

  function bulkRemove() {
    startBulk(async () => {
      const result = await removeCarrierPharmacyRows(carrierId, planYear, [...selected]);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`${result.data.count.toLocaleString()} removed from the network`);
      setSelected(new Set());
      router.refresh();
    });
  }

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center gap-1.5">
        <FilterChip
          active={statusFilter === "all"}
          onClick={() => {
            setStatusFilter("all");
            resetPaging();
          }}
        >
          All · {rows.length.toLocaleString()}
        </FilterChip>
        {STATUS_OPTIONS.map((option) => (
          <FilterChip
            key={option.value}
            active={statusFilter === option.value}
            onClick={() => {
              setStatusFilter(statusFilter === option.value ? "all" : option.value);
              resetPaging();
            }}
          >
            {option.label} · {(statusCounts.get(option.value) ?? 0).toLocaleString()}
          </FilterChip>
        ))}
        <span className="mx-1 h-4 w-px bg-mist" />
        {[...sourceCounts.entries()].map(([source, count]) => (
          <FilterChip
            key={source}
            active={sourceFilter === source}
            onClick={() => {
              setSourceFilter(sourceFilter === source ? "all" : source);
              resetPaging();
            }}
          >
            {source} · {count.toLocaleString()}
          </FilterChip>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-steel" />
          <Input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              resetPaging();
            }}
            placeholder="Filter by name, brand, city, or ZIP…"
            className="w-72 pl-8"
          />
        </div>
        <span className="text-data text-xs text-steel">
          {filtered.length.toLocaleString()} shown
          {selected.size > 0 ? ` · ${selected.size.toLocaleString()} selected` : ""}
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          {selected.size > 0 ? (
            <>
              {STATUS_OPTIONS.map((option) => (
                <Button
                  key={option.value}
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={bulkPending}
                  onClick={() => bulkStatus(option.value)}
                >
                  {option.label}
                </Button>
              ))}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-notcovered hover:bg-notcovered-soft hover:text-notcovered"
                disabled={bulkPending}
                onClick={bulkRemove}
              >
                <Trash2 className="size-3.5" />
                Remove
              </Button>
            </>
          ) : (
            <Button type="button" variant="secondary" size="sm" onClick={() => setAddOpen(true)}>
              <Plus className="size-4" />
              Add pharmacy
            </Button>
          )}
        </div>
      </div>

      {filtered.length === 0 ? (
        <p className="rounded-card border border-dashed border-mist bg-white px-6 py-8 text-center text-sm text-steel">
          {rows.length === 0
            ? "No network rows for this year yet — upload a directory, copy last year, or add pharmacies by hand."
            : "Nothing matches the current filters."}
        </p>
      ) : (
        <div className="rounded-card border border-mist/60 bg-white shadow-card">
          <Table>
            <THead>
              <TRow>
                <TH className="w-10">
                  <Checkbox
                    checked={allFilteredSelected}
                    onCheckedChange={toggleAllFiltered}
                    aria-label="Select every filtered row"
                  />
                </TH>
                <TH>Pharmacy</TH>
                <TH>City</TH>
                <TH className="w-20">ZIP</TH>
                <TH className="w-44">Status</TH>
                <TH>Provenance</TH>
              </TRow>
            </THead>
            <TBody>
              {visible.map((row) => (
                <TRow key={row.pharmacyId} className="hover:bg-transparent">
                  <TCell>
                    <Checkbox
                      checked={selected.has(row.pharmacyId)}
                      onCheckedChange={() =>
                        setSelected((prev) => {
                          const next = new Set(prev);
                          if (next.has(row.pharmacyId)) next.delete(row.pharmacyId);
                          else next.add(row.pharmacyId);
                          return next;
                        })
                      }
                      aria-label={`Select ${row.name}`}
                    />
                  </TCell>
                  <TCell>
                    <div className="text-sm font-semibold text-deepwater">{row.name}</div>
                    {row.brandName && row.brandName !== row.name ? (
                      <div className="text-xs text-steel">{row.brandName}</div>
                    ) : null}
                  </TCell>
                  <TCell className="text-sm text-steel">{row.city ?? "—"}</TCell>
                  <TCell className="text-data text-sm">{row.zip ?? "—"}</TCell>
                  <TCell>
                    <Select
                      value={row.status}
                      onValueChange={(next) =>
                        setOneStatus(row.pharmacyId, next as NetworkStatus)
                      }
                      disabled={pendingId === row.pharmacyId || bulkPending}
                    >
                      <SelectTrigger
                        className={cn("h-8 w-40", pendingId === row.pharmacyId && "opacity-60")}
                      >
                        <SelectValue>
                          <NetworkStatusChip status={row.status} />
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {STATUS_OPTIONS.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TCell>
                  <TCell>
                    <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-steel">
                      {row.source}
                    </span>
                    {row.verifiedByName ? (
                      <span className="block text-xs text-steel">
                        {row.verifiedByName}
                        {row.verifiedAt
                          ? ` · ${new Date(row.verifiedAt).toLocaleDateString()}`
                          : ""}
                      </span>
                    ) : null}
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

      {addOpen ? (
        <AddPharmacyDialog
          carrierId={carrierId}
          planYear={planYear}
          inNetworkIds={new Set(rows.map((r) => r.pharmacyId))}
          onClose={() => setAddOpen(false)}
          onAdded={() => router.refresh()}
        />
      ) : null}
    </section>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-chip px-2.5 py-1 font-mono text-[11px] font-semibold uppercase tracking-[0.08em] transition-colors",
        active ? "bg-harbor text-white" : "bg-fog text-steel hover:bg-mist/60",
      )}
    >
      {children}
    </button>
  );
}

function AddPharmacyDialog({
  carrierId,
  planYear,
  inNetworkIds,
  onClose,
  onAdded,
}: {
  carrierId: string;
  planYear: number;
  inNetworkIds: Set<string>;
  onClose: () => void;
  onAdded: () => void;
}) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<PharmacySearchHit[]>([]);
  const [searching, startSearch] = useTransition();
  const [status, setStatus] = useState<NetworkStatus>("preferred");
  const [addingId, setAddingId] = useState<string | null>(null);
  const [, startAdd] = useTransition();
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const runSearch = (q: string) => {
    setQuery(q);
    if (debounce.current) clearTimeout(debounce.current);
    if (q.trim().length < 2) {
      setHits([]);
      return;
    }
    debounce.current = setTimeout(() => {
      startSearch(async () => {
        const result = await searchPharmacies(q.trim());
        if (result.ok) setHits(result.data.filter((hit) => !inNetworkIds.has(hit.id)));
      });
    }, 250);
  };

  const add = (hit: PharmacySearchHit) => {
    setAddingId(hit.id);
    startAdd(async () => {
      const result = await setCarrierPharmacyStatus(carrierId, planYear, hit.id, status);
      setAddingId(null);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`${hit.name} added as ${STATUS_LABEL[status]}`);
      setHits((previous) => previous.filter((h) => h.id !== hit.id));
      onAdded();
    });
  };

  return (
    <Dialog open onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Add pharmacies to the {planYear} network</DialogTitle>
          <DialogDescription>
            From the master list — added rows are agent-verified and outrank imports.
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-2">
          <Input
            autoFocus
            value={query}
            onChange={(e) => runSearch(e.target.value)}
            placeholder="Search the master list — name, city, or ZIP…"
            className="flex-1"
          />
          <Select value={status} onValueChange={(v) => setStatus(v as NetworkStatus)}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATUS_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <ul className="max-h-72 overflow-y-auto">
          {searching ? (
            <li className="flex items-center gap-2 px-1 py-2 text-sm text-steel">
              <Loader2 className="size-4 animate-spin" /> Searching…
            </li>
          ) : null}
          {hits.map((hit) => (
            <li key={hit.id} className="flex items-center justify-between gap-3 border-b border-mist/40 px-1 py-2 last:border-0">
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium text-deepwater">
                  {hit.name}
                </span>
                <span className="text-xs text-steel">
                  {[hit.city, hit.state].filter(Boolean).join(", ")}
                  {hit.zip ? <span className="text-data"> {hit.zip}</span> : null}
                </span>
              </span>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={addingId === hit.id}
                onClick={() => add(hit)}
              >
                {addingId === hit.id ? <Loader2 className="size-4 animate-spin" /> : "Add"}
              </Button>
            </li>
          ))}
          {!searching && query.trim().length >= 2 && hits.length === 0 ? (
            <li className="px-1 py-2 text-sm text-steel">
              No master-list pharmacies match (or they&apos;re already in the network).
            </li>
          ) : null}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
