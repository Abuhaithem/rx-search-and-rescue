"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { Search, X } from "lucide-react";
import type { NetworkStatus } from "@rxsr/core";
import {
  removeCarrierPharmacyStatus,
  setCarrierPharmacyStatus,
} from "@/server/actions/admin";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Table, TBody, TCell, TH, THead, TRow } from "@/components/ui/table";
import { NetworkStatusChip } from "@/components/domain/network-status-chip";
import { toast } from "@/components/ui/sonner";
import { cn } from "@/lib/utils";
import type { CarrierNetworkEditorRow } from "../../../../_lib/pharmacies";

const VISIBLE_STEP = 150;

const STATUS_OPTIONS: { value: NetworkStatus; label: string }[] = [
  { value: "preferred", label: "In network · Preferred" },
  { value: "standard", label: "In network · Standard" },
  { value: "out_of_network", label: "Not in network" },
];

const STATUS_FILTERS = [
  ["all", "All"],
  ["preferred", "Preferred"],
  ["standard", "Standard"],
  ["out_of_network", "Out of network"],
] as const;

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
  const [statusFilter, setStatusFilter] = useState<(typeof STATUS_FILTERS)[number][0]>("all");
  const [visibleCount, setVisibleCount] = useState(VISIBLE_STEP);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const statusCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of rows) counts.set(row.status, (counts.get(row.status) ?? 0) + 1);
    return counts;
  }, [rows]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((row) => {
      if (statusFilter !== "all" && row.status !== statusFilter) return false;
      if (q === "") return true;
      return (
        row.name.toLowerCase().includes(q) ||
        (row.brandName ?? "").toLowerCase().includes(q) ||
        (row.city ?? "").toLowerCase().includes(q) ||
        (row.zip ?? "").includes(q)
      );
    });
  }, [rows, query, statusFilter]);
  const visible = filtered.slice(0, visibleCount);

  const setStatus = (pharmacyId: string, status: NetworkStatus) => {
    setPendingId(pharmacyId);
    startTransition(async () => {
      const result = await setCarrierPharmacyStatus(carrierId, planYear, pharmacyId, status);
      setPendingId(null);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      router.refresh();
    });
  };

  const remove = (row: CarrierNetworkEditorRow) => {
    setPendingId(row.pharmacyId);
    startTransition(async () => {
      const result = await removeCarrierPharmacyStatus(carrierId, planYear, row.pharmacyId);
      setPendingId(null);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`${row.name} removed — pricing now assumes standard`);
      router.refresh();
    });
  };

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1">
          {STATUS_FILTERS.map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => {
                setStatusFilter(value);
                setVisibleCount(VISIBLE_STEP);
              }}
              className={cn(
                "rounded-chip px-2.5 py-1 font-mono text-[11px] font-semibold uppercase tracking-[0.08em] transition-colors",
                statusFilter === value
                  ? "bg-harbor text-white"
                  : "bg-fog text-steel hover:bg-mist/60",
              )}
            >
              {label}
              {value !== "all" ? ` · ${(statusCounts.get(value) ?? 0).toLocaleString()}` : ` · ${rows.length.toLocaleString()}`}
            </button>
          ))}
        </div>
        <div className="relative ml-auto">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-steel" />
          <Input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setVisibleCount(VISIBLE_STEP);
            }}
            placeholder="Filter by pharmacy, brand, city, or ZIP…"
            className="w-72 pl-8"
          />
        </div>
      </div>

      {filtered.length === 0 ? (
        <p className="rounded-card border border-dashed border-mist bg-white px-6 py-8 text-center text-sm text-steel">
          {rows.length === 0
            ? "No network rows for this year yet — upload a directory or copy last year's network from the carrier page."
            : "No rows match the current filters."}
        </p>
      ) : (
        <div className="rounded-card border border-mist/60 bg-white shadow-card">
          <Table>
            <THead>
              <TRow>
                <TH>Pharmacy</TH>
                <TH>Location</TH>
                <TH className="w-32">Status</TH>
                <TH className="w-44">Set status</TH>
                <TH className="w-40">Source</TH>
                <TH className="w-10" aria-label="Remove" />
              </TRow>
            </THead>
            <TBody>
              {visible.map((row) => (
                <TRow key={row.pharmacyId} className="hover:bg-transparent">
                  <TCell>
                    <p className="text-sm font-semibold text-deepwater">{row.name}</p>
                    {row.brandName && row.brandName !== row.name ? (
                      <p className="text-xs text-steel">{row.brandName}</p>
                    ) : null}
                  </TCell>
                  <TCell className="text-sm text-steel">
                    {row.city ?? "—"}
                    {row.zip ? (
                      <>
                        {" "}
                        · <span className="text-data">{row.zip}</span>
                      </>
                    ) : null}
                  </TCell>
                  <TCell>
                    <NetworkStatusChip status={row.status} />
                  </TCell>
                  <TCell>
                    <Select
                      value={row.status}
                      onValueChange={(value) => setStatus(row.pharmacyId, value as NetworkStatus)}
                      disabled={pendingId === row.pharmacyId}
                    >
                      <SelectTrigger className="h-8 w-40 text-[13px]">
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
                  </TCell>
                  <TCell>
                    <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-steel">
                      {row.source}
                    </span>
                    {row.verifiedByName ? (
                      <p className="text-[11px] text-steel">by {row.verifiedByName}</p>
                    ) : null}
                  </TCell>
                  <TCell>
                    <button
                      type="button"
                      aria-label={`Remove ${row.name} from the network`}
                      title="Remove from network"
                      className="rounded-md p-1 text-steel hover:bg-notcovered-soft hover:text-notcovered"
                      disabled={pendingId === row.pharmacyId}
                      onClick={() => remove(row)}
                    >
                      <X className="size-3.5" />
                    </button>
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
    </section>
  );
}
