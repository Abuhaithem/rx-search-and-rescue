"use client";

import { useRouter } from "next/navigation";
import type { AnalysisStatus } from "@rxsr/core";
import { StatusChip } from "@/components/domain/status-chip";
import { Table, TBody, TCell, TH, THead, TRow } from "@/components/ui/table";

export interface QueueRow {
  analysisId: string;
  clientName: string;
  agentName: string | null;
  planYear: number;
  plansCompared: number;
  status: AnalysisStatus;
  updatedAtIso: string;
  href: string;
}

function formatRelative(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === now.toDateString()) {
    return `Today ${date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;
  }
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
  if (date.getFullYear() === now.getFullYear()) {
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function QueueTable({ rows }: { rows: QueueRow[] }) {
  const router = useRouter();

  return (
    <Table>
      <THead>
        <tr>
          <TH>Client</TH>
          <TH>Agent</TH>
          <TH>Plan year</TH>
          <TH>Plans compared</TH>
          <TH>Status</TH>
          <TH>Last updated</TH>
        </tr>
      </THead>
      <TBody>
        {rows.map((row) => (
          <TRow
            key={row.analysisId}
            onClick={() => router.push(row.href)}
            onKeyDown={(e) => {
              if (e.key === "Enter") router.push(row.href);
            }}
            tabIndex={0}
            className="cursor-pointer focus-visible:bg-fog/80 focus-visible:outline-none"
          >
            <TCell className="font-semibold">{row.clientName}</TCell>
            <TCell className="text-steel">{row.agentName ?? "—"}</TCell>
            <TCell className="text-data">{row.planYear}</TCell>
            <TCell className="text-steel">
              {row.plansCompared > 0 ? `${row.plansCompared} selected` : "—"}
            </TCell>
            <TCell>
              <StatusChip status={row.status} />
            </TCell>
            <TCell className="text-steel" suppressHydrationWarning>
              {formatRelative(row.updatedAtIso)}
            </TCell>
          </TRow>
        ))}
      </TBody>
    </Table>
  );
}
