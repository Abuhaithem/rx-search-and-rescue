"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { Download } from "lucide-react";
import type { AnalysisStatus } from "@rxsr/core";
import type { ReportModel } from "@rxsr/core/report-model";
import {
  approveAnalysis,
  clearOverride,
  markDelivered,
  runComparison,
  saveOverride,
} from "@/server/actions/analysis";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/sonner";
import { PageHeader } from "@/components/domain/page-header";
import { WorkflowNav } from "@/components/domain/workflow-nav";
import { cn } from "@/lib/utils";

interface ReportEditorProps {
  analysisId: string;
  clientId: string;
  model: ReportModel;
  status: AnalysisStatus;
}

const CHECKLIST = [
  "Medication list confirmed with client",
  "Current plan verified",
  "Pharmacy status confirmed per plan",
  "Notes reviewed",
  "Disclaimer included (automatic)",
];

function StatusBadge({ status }: { status: AnalysisStatus }) {
  const approved = status === "approved" || status === "delivered";
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-chip px-2 py-0.5 font-mono text-[11px] font-medium uppercase tracking-[0.08em]",
        approved ? "bg-covered-soft text-covered" : "bg-restricted-soft text-restricted",
      )}
    >
      {status === "delivered" ? "Delivered" : approved ? "Approved" : "Draft"}
    </span>
  );
}

export function ReportEditor({ analysisId, clientId, model, status }: ReportEditorProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [agentNotes, setAgentNotes] = useState(model.agentNotes);
  const [notesState, setNotesState] = useState<"idle" | "saving" | "saved">("idle");
  const notesTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedNotes = useRef(model.agentNotes);

  const [editing, setEditing] = useState<{ row: number; col: number; value: string } | null>(null);
  /** Committed-but-not-yet-refreshed cell displays, keyed "row:col". */
  const [optimistic, setOptimistic] = useState<Record<string, string>>({});
  const [checked, setChecked] = useState<boolean[]>(CHECKLIST.map((_, i) => i === 4));

  useEffect(() => {
    setOptimistic({});
  }, [model]);

  useEffect(() => () => {
    if (notesTimer.current) clearTimeout(notesTimer.current);
  }, []);

  const persistNotes = (value: string) => {
    if (value === lastSavedNotes.current) return;
    setNotesState("saving");
    startTransition(async () => {
      const result = await saveOverride(analysisId, "agentNotes", value);
      if (result.ok) {
        lastSavedNotes.current = value;
        setNotesState("saved");
      } else {
        setNotesState("idle");
        toast.error(result.error);
      }
    });
  };

  const onNotesChange = (value: string) => {
    setAgentNotes(value);
    if (notesTimer.current) clearTimeout(notesTimer.current);
    notesTimer.current = setTimeout(() => persistNotes(value), 800);
  };

  const commitCell = (row: number, col: number, value: string) => {
    setEditing(null);
    const current = optimistic[`${row}:${col}`] ?? model.grid[row]?.cells[col]?.display;
    const next = value.trim();
    if (!next || next === current) return;
    setOptimistic((prev) => ({ ...prev, [`${row}:${col}`]: next }));
    startTransition(async () => {
      const result = await saveOverride(analysisId, `grid.${row}.${col}.display`, next);
      if (!result.ok) {
        setOptimistic((prev) => {
          const copy = { ...prev };
          delete copy[`${row}:${col}`];
          return copy;
        });
        toast.error(result.error);
      }
    });
  };

  const clearCell = (row: number, col: number) => {
    startTransition(async () => {
      const result = await clearOverride(analysisId, `grid.${row}.${col}.display`);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      router.refresh();
    });
  };

  const regenerate = () => {
    startTransition(async () => {
      const result = await runComparison(analysisId);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Comparison regenerated — your edits are preserved");
      router.refresh();
    });
  };

  const approve = () => {
    startTransition(async () => {
      const result = await approveAnalysis(analysisId);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Report approved — Word document generated");
      router.refresh();
    });
  };

  const deliver = () => {
    startTransition(async () => {
      const result = await markDelivered(analysisId);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Marked delivered");
      router.refresh();
    });
  };

  const approved = status === "approved" || status === "delivered";

  return (
    <div className="space-y-6">
      <WorkflowNav analysisId={analysisId} clientId={clientId} current="report" />
      <PageHeader
        title={`Report — ${model.clientName}`}
        meta={<StatusBadge status={status} />}
        actions={
          <>
            {status === "in_review" ? (
              <Button variant="secondary" onClick={regenerate} disabled={pending}>
                Regenerate
              </Button>
            ) : null}
            <Button
              variant="rescue"
              onClick={approve}
              disabled={pending || status !== "in_review"}
              className={pending ? "opacity-70" : undefined}
            >
              Approve ✓
            </Button>
          </>
        }
      />

      <div className="grid items-start gap-6 lg:grid-cols-[1fr_320px]">
        {/* ── Report preview: ink on paper only — no orange, ever ── */}
        <Card>
          <CardHeader>
            <CardTitle>Report preview</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-5 rounded-card border border-mist/60 p-6">
              <div>
                <h2 className="font-display text-lg font-extrabold text-deepwater">
                  Prescription Drug Plan Analysis — {model.clientName}
                </h2>
                <p className="mt-0.5 text-xs text-steel">
                  {model.agencyName} · Plan year {model.planYear}
                  {model.preparedBy ? ` · Prepared by ${model.preparedBy}` : ""}
                </p>
              </div>

              {model.pharmacyNotes.length > 0 ? (
                <div className="space-y-1">
                  {model.pharmacyNotes.map((note, i) => (
                    <p key={i} className="text-sm text-deepwater">
                      {note}
                    </p>
                  ))}
                </div>
              ) : null}

              {agentNotes.trim() ? (
                <p className="whitespace-pre-wrap text-sm text-deepwater">{agentNotes}</p>
              ) : null}

              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr>
                      <th className="border border-deepwater bg-deepwater px-3 py-1.5 text-left font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-white">
                        Drug
                      </th>
                      {model.planNames.map((name, i) => (
                        <th
                          key={i}
                          className="border border-deepwater bg-deepwater px-3 py-1.5 text-center font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-white"
                        >
                          {name}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {model.grid.map((gridRow, rowIndex) => (
                      <tr key={rowIndex}>
                        <td className="border border-mist px-3 py-1.5 font-semibold text-deepwater">
                          {gridRow.medicationName}
                        </td>
                        {gridRow.cells.map((cell, colIndex) => {
                          const key = `${rowIndex}:${colIndex}`;
                          const display = optimistic[key] ?? cell.display;
                          const overridden = cell.overridden || key in optimistic;
                          const negative =
                            cell.coverage === "not_covered" || cell.coverage === "not_on_formulary";
                          const isEditing =
                            editing?.row === rowIndex && editing?.col === colIndex;
                          return (
                            <td
                              key={colIndex}
                              onDoubleClick={() =>
                                setEditing({ row: rowIndex, col: colIndex, value: display })
                              }
                              onContextMenu={(e) => {
                                if (overridden) {
                                  e.preventDefault();
                                  clearCell(rowIndex, colIndex);
                                }
                              }}
                              title={
                                overridden
                                  ? "Edited by agent — right-click or × to restore"
                                  : "Double-click to edit"
                              }
                              className="group relative cursor-text border border-mist px-3 py-1.5 text-center"
                            >
                              {isEditing ? (
                                <input
                                  autoFocus
                                  value={editing.value}
                                  onChange={(e) =>
                                    setEditing({ row: rowIndex, col: colIndex, value: e.target.value })
                                  }
                                  onBlur={() => commitCell(rowIndex, colIndex, editing.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") commitCell(rowIndex, colIndex, editing.value);
                                    if (e.key === "Escape") setEditing(null);
                                  }}
                                  className="text-data w-full border-0 bg-fog p-0 text-center text-sm text-deepwater outline-none"
                                />
                              ) : (
                                <span
                                  className={cn(
                                    "text-data text-sm",
                                    negative ? "text-notcovered" : "text-deepwater",
                                  )}
                                >
                                  {display}
                                </span>
                              )}
                              {overridden && !isEditing ? (
                                <>
                                  <span
                                    aria-hidden
                                    className="absolute right-1 top-1 size-1.5 rounded-full bg-steel"
                                  />
                                  <button
                                    type="button"
                                    aria-label="Restore generated value"
                                    onClick={() => clearCell(rowIndex, colIndex)}
                                    className="absolute -right-0.5 -top-0.5 hidden rounded-full bg-white px-1 text-[10px] font-semibold text-steel shadow-card hover:text-notcovered group-hover:block"
                                  >
                                    ×
                                  </button>
                                </>
                              ) : null}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="space-y-4">
                {model.benefits.map((plan, i) => (
                  <div key={i} className="overflow-x-auto">
                    <table className="w-full border-collapse text-sm">
                      <thead>
                        <tr>
                          <th className="border border-deepwater bg-deepwater px-3 py-1.5 text-left font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-white">
                            {plan.planName}
                          </th>
                          {plan.channelHeaders.map((header, j) => (
                            <th
                              key={j}
                              className="border border-deepwater bg-deepwater px-3 py-1.5 text-center font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-white"
                            >
                              {header}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        <tr>
                          <td className="border border-mist px-3 py-1.5 text-deepwater">Premium</td>
                          <td
                            colSpan={Math.max(plan.channelHeaders.length, 1)}
                            className="text-data border border-mist px-3 py-1.5 text-center text-deepwater"
                          >
                            {plan.premium}
                          </td>
                        </tr>
                        <tr>
                          <td className="border border-mist px-3 py-1.5 text-deepwater">
                            Rx Deductible
                          </td>
                          <td
                            colSpan={Math.max(plan.channelHeaders.length, 1)}
                            className="text-data border border-mist px-3 py-1.5 text-center text-deepwater"
                          >
                            {plan.rxDeductible}
                          </td>
                        </tr>
                        {plan.tierRows.map((tierRow, j) => (
                          <tr key={j}>
                            <td className="text-data border border-mist px-3 py-1.5 text-deepwater">
                              {tierRow.label}
                            </td>
                            {tierRow.values.map((value, k) => (
                              <td
                                key={k}
                                className="text-data border border-mist px-3 py-1.5 text-center text-deepwater"
                              >
                                {value}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ))}
              </div>

              {model.deductibleFootnote ? (
                <p className="text-xs text-steel">{model.deductibleFootnote}</p>
              ) : null}
              {model.disclaimer ? <p className="text-[11px] text-steel">{model.disclaimer}</p> : null}
            </div>
            <p className="mt-2 text-xs text-steel">
              Double-click any grid cell to edit its display text. Edited cells show a dot — click ×
              (or right-click) to restore the generated value. Edits survive re-runs.
            </p>
          </CardContent>
        </Card>

        {/* ── Right panel ── */}
        <div className="space-y-6">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle>Agent notes (appear in the report)</CardTitle>
            </CardHeader>
            <CardContent>
              <Textarea
                value={agentNotes}
                onChange={(e) => onNotesChange(e.target.value)}
                onBlur={() => {
                  if (notesTimer.current) clearTimeout(notesTimer.current);
                  persistNotes(agentNotes);
                }}
                rows={5}
                placeholder="Doctors, remarks, mail-order comparison…"
              />
              <p className="mt-1 h-4 text-xs text-steel">
                {notesState === "saving" ? "Saving…" : notesState === "saved" ? "Saved" : ""}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle>Checklist before approving</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2.5">
              {CHECKLIST.map((item, i) => (
                <div key={item} className="flex items-center gap-2">
                  <Checkbox
                    id={`check-${i}`}
                    checked={checked[i] === true}
                    onCheckedChange={(value) =>
                      setChecked((prev) => prev.map((c, j) => (j === i ? value === true : c)))
                    }
                  />
                  <Label htmlFor={`check-${i}`} className="font-normal">
                    {item}
                  </Label>
                </div>
              ))}
            </CardContent>
          </Card>

          {approved ? (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle>After approval</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <a
                  href={`/analysis/${analysisId}/report/download`}
                  className="inline-flex items-center gap-2 text-sm font-semibold text-deepwater underline-offset-2 hover:underline"
                >
                  <Download className="size-4" />
                  Download Word document
                </a>
                {status === "approved" ? (
                  <div>
                    <Button variant="secondary" size="sm" onClick={deliver} disabled={pending}>
                      Mark delivered
                    </Button>
                  </div>
                ) : (
                  <p className="text-xs text-steel">Delivered to client.</p>
                )}
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}
