"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/sonner";
import { Table, TBody, TCell, TH, THead, TRow } from "@/components/ui/table";
import { upsertPlan, upsertTierCosts } from "@/server/actions/admin";
import type { PlanUpsertInput, TierCostRowInput } from "@/server/schemas";
import type { PlanCatalogRow } from "@/server/queries/plans";
import { DeletePlanButton } from "./delete-plan-button";
import { centsToDollarInput, parseDollarsToCents } from "./money";
import { TierChecklist } from "./tier-checklist";

const CHANNEL_ORDER = [
  "preferred_retail",
  "standard_retail",
  "preferred_mail",
  "standard_mail",
] as const;
type Channel = (typeof CHANNEL_ORDER)[number];

const CHANNEL_LABEL: Record<Channel, string> = {
  preferred_retail: "Preferred retail",
  standard_retail: "Standard retail",
  preferred_mail: "Preferred mail",
  standard_mail: "Standard mail",
};

interface GridRow {
  /** Stable identity for cell values while channel/days are being edited. */
  id: number;
  channel: Channel;
  /** Fill length in days as typed — validated on save. */
  days: string;
}

const rowTitle = (row: GridRow) =>
  `${CHANNEL_LABEL[row.channel]} — ${row.days.trim() === "" ? "?" : row.days.trim()} day`;

/** Documents vary: 30/90 is common but 60- and 100-day supplies exist too. */
const DEFAULT_ROWS: Omit<GridRow, "id">[] = [
  { channel: "preferred_retail", days: "30" },
  { channel: "standard_retail", days: "30" },
  { channel: "preferred_mail", days: "90" },
  { channel: "standard_mail", days: "90" },
];

const TIERS = [
  { tier: "t1", label: "T1" },
  { tier: "t2", label: "T2" },
  { tier: "t3", label: "T3" },
  { tier: "t4", label: "T4" },
  { tier: "t5", label: "T5" },
  { tier: "t6", label: "T6" },
  { tier: "insulin", label: "Insulin" },
] as const;

/** Pricing on file → editable rows + cell values keyed by row id and tier. */
function buildGridState(tierCosts: PlanCatalogRow["tierCosts"]): {
  rows: GridRow[];
  values: Record<string, string>;
} {
  const sorted = [...tierCosts].sort((a, b) =>
    a.channel === b.channel
      ? a.daysSupply - b.daysSupply
      : CHANNEL_ORDER.indexOf(a.channel as Channel) - CHANNEL_ORDER.indexOf(b.channel as Channel),
  );
  const rowIdByCombo = new Map<string, number>();
  const rows: GridRow[] = [];
  const values: Record<string, string> = {};
  for (const tc of sorted) {
    const combo = `${tc.channel}|${tc.daysSupply}`;
    let id = rowIdByCombo.get(combo);
    if (id === undefined) {
      id = rows.length;
      rowIdByCombo.set(combo, id);
      rows.push({ id, channel: tc.channel as Channel, days: String(tc.daysSupply) });
    }
    const display =
      tc.copayCents != null
        ? `$${centsToDollarInput(tc.copayCents)}`
        : tc.coinsurancePct != null
          ? `${tc.coinsurancePct % 1 === 0 ? tc.coinsurancePct.toFixed(0) : tc.coinsurancePct}%`
          : "";
    if (display) values[`${id}|${tc.tier}`] = display;
  }
  if (rows.length === 0) {
    return { rows: DEFAULT_ROWS.map((row, id) => ({ ...row, id })), values: {} };
  }
  return { rows, values };
}

type CellParse =
  | { copayCents: number; coinsurancePct: null }
  | { copayCents: null; coinsurancePct: number }
  | null
  | "invalid";

/** "$10" → copay cents; "50%" → coinsurance; "" → no row. */
function parseCell(raw: string): CellParse {
  const value = raw.trim();
  if (value === "") return null;
  if (value.endsWith("%")) {
    const pct = Number(value.slice(0, -1).trim());
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) return "invalid";
    return { copayCents: null, coinsurancePct: pct };
  }
  const cents = parseDollarsToCents(value);
  if (cents == null || Number.isNaN(cents)) return "invalid";
  return { copayCents: cents, coinsurancePct: null };
}

export function PlanEditor({ row }: { row: PlanCatalogRow }) {
  const router = useRouter();
  const plan = row.plan;
  const [premium, setPremium] = useState(centsToDollarInput(plan.premiumCents));
  const [deductible, setDeductible] = useState(centsToDollarInput(plan.rxDeductibleCents));
  const [deductibleTiers, setDeductibleTiers] = useState<number[]>(plan.deductibleTiers);
  const [initialGrid] = useState(() => buildGridState(row.tierCosts));
  const [grid, setGrid] = useState<Record<string, string>>(initialGrid.values);
  const [gridRows, setGridRows] = useState<GridRow[]>(initialGrid.rows);
  const [nextRowId, setNextRowId] = useState(initialGrid.rows.length);
  // Display labels only — tier identity stays t1..t6/insulin.
  const [tierLabels, setTierLabels] = useState<Record<string, string>>(() => ({
    ...plan.tierLabels,
  }));
  const [isPending, startTransition] = useTransition();

  function handleSave() {
    const premiumCents = parseDollarsToCents(premium);
    const rxDeductibleCents = parseDollarsToCents(deductible);
    if (Number.isNaN(premiumCents) || Number.isNaN(rxDeductibleCents)) {
      toast.error('Premium and deductible take dollars — e.g. "0", "12.40", "$275"');
      return;
    }

    const tierCostRows: TierCostRowInput[] = [];
    const seenCombos = new Set<string>();
    for (const gridRow of gridRows) {
      const days = Number((gridRow.days.match(/\d+/) ?? [])[0]);
      if (!Number.isInteger(days) || days < 1 || days > 365) {
        toast.error(
          `The ${CHANNEL_LABEL[gridRow.channel]} row needs a days supply — e.g. 30, 60, 90, 100`,
        );
        return;
      }
      const combo = `${gridRow.channel}|${days}`;
      if (seenCombos.has(combo)) {
        toast.error(
          `${CHANNEL_LABEL[gridRow.channel]} — ${days} day appears twice — merge those rows`,
        );
        return;
      }
      seenCombos.add(combo);
      for (const tier of TIERS) {
        const raw = grid[`${gridRow.id}|${tier.tier}`] ?? "";
        const parsed = parseCell(raw);
        if (parsed === "invalid") {
          toast.error(
            `Can't read "${raw.trim()}" for ${rowTitle(gridRow)}, ${tier.label} — use "$10", "$47.50", or "50%"`,
          );
          return;
        }
        if (parsed == null) continue;
        tierCostRows.push({
          channel: gridRow.channel,
          tier: tier.tier,
          daysSupply: days,
          copayCents: parsed.copayCents,
          coinsurancePct: parsed.coinsurancePct,
        });
      }
    }

    const cleanedTierLabels: NonNullable<PlanUpsertInput["tierLabels"]> = {};
    for (const tier of TIERS) {
      const label = (tierLabels[tier.tier] ?? "").trim();
      if (label !== "") cleanedTierLabels[tier.tier] = label;
    }

    startTransition(async () => {
      const metaResult = await upsertPlan({
        id: plan.id,
        carrierId: plan.carrierId,
        formularyId: plan.formularyId,
        planYear: plan.planYear,
        name: plan.name,
        contractPlanId: plan.contractPlanId,
        premiumCents,
        rxDeductibleCents,
        deductibleTiers,
        curated: plan.curated,
        tierLabels: cleanedTierLabels,
      });
      if (!metaResult.ok) {
        toast.error(metaResult.error);
        return;
      }
      if (tierCostRows.length > 0) {
        const costsResult = await upsertTierCosts(plan.id, tierCostRows);
        if (!costsResult.ok) {
          toast.error(costsResult.error);
          return;
        }
      }
      toast.success("Plan saved");
      router.refresh();
    });
  }

  const inSetup = row.formularyStatus === "ingesting" || row.formularyStatus === "qa";

  return (
    <Card>
      <CardContent className="space-y-6 p-5">
        {inSetup ? (
          <p className="rounded-card bg-restricted-soft px-4 py-3 text-sm text-restricted">
            <span className="font-semibold">Still in setup.</span> This plan&apos;s formulary
            wizard was never finalized, so agents can&apos;t see or select it yet.{" "}
            <Link
              href={`/admin/formularies/upload?formulary=${plan.formularyId}&step=2`}
              className="font-semibold underline"
            >
              Resume setup →
            </Link>
          </p>
        ) : null}
        <div className="space-y-1">
          <h2 className="font-display text-lg font-extrabold leading-tight text-deepwater">
            {plan.name}
          </h2>
          <p className="text-sm text-steel">
            {row.carrierName} · Counties:{" "}
            {row.serviceAreas.length > 0
              ? row.serviceAreas.map((a) => a.county).join(", ")
              : "none set"}{" "}
            · Formulary:{" "}
            {row.formularyLabel ?? "none linked"}
            {row.formularyStatus === "active" ? <span className="text-covered"> ✓</span> : null}
            {plan.contractPlanId ? (
              <>
                {" "}
                · <span className="text-data">{plan.contractPlanId}</span>
              </>
            ) : null}
          </p>
        </div>

        <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="editor-premium">Premium / mo ($)</Label>
            <Input
              id="editor-premium"
              inputMode="decimal"
              placeholder="0.00"
              className="text-data w-28"
              value={premium}
              onChange={(event) => setPremium(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="editor-deductible">Rx deductible ($)</Label>
            <Input
              id="editor-deductible"
              inputMode="decimal"
              placeholder="0.00"
              className="text-data w-28"
              value={deductible}
              onChange={(event) => setDeductible(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Deductible applies to</Label>
            <TierChecklist value={deductibleTiers} onChange={setDeductibleTiers} />
          </div>
        </div>

        <section className="space-y-2">
          <h3 className="text-sm font-semibold text-deepwater">
            Tier cost sharing (from Summary of Benefits)
          </h3>
          <div className="rounded-card border border-mist/60">
            <Table>
              <THead>
                <TRow>
                  <TH>Pharmacy channel</TH>
                  {TIERS.map((tier) => (
                    <TH key={tier.tier} className="w-20">
                      <div className="flex flex-col gap-1 py-1">
                        <span>{tier.label}</span>
                        <Input
                          aria-label={`${tier.label} display label`}
                          placeholder={tier.label}
                          className="h-7 w-16 px-1.5 text-[11px] font-normal"
                          value={tierLabels[tier.tier] ?? ""}
                          onChange={(event) =>
                            setTierLabels((previous) => ({
                              ...previous,
                              [tier.tier]: event.target.value,
                            }))
                          }
                        />
                      </div>
                    </TH>
                  ))}
                </TRow>
              </THead>
              <TBody>
                {gridRows.map((gridRow) => (
                  <TRow key={gridRow.id} className="hover:bg-transparent">
                    <TCell className="whitespace-nowrap">
                      <div className="flex items-center gap-1.5">
                        <select
                          aria-label="Pharmacy channel"
                          className="h-8 rounded-md border border-mist bg-white px-2 text-sm font-semibold"
                          value={gridRow.channel}
                          onChange={(event) =>
                            setGridRows((previous) =>
                              previous.map((r) =>
                                r.id === gridRow.id
                                  ? { ...r, channel: event.target.value as Channel }
                                  : r,
                              ),
                            )
                          }
                        >
                          {CHANNEL_ORDER.map((channel) => (
                            <option key={channel} value={channel}>
                              {CHANNEL_LABEL[channel]}
                            </option>
                          ))}
                        </select>
                        <Input
                          aria-label={`Days supply for ${CHANNEL_LABEL[gridRow.channel]}`}
                          inputMode="numeric"
                          placeholder="30"
                          className="text-data h-8 w-14 px-2 text-[13px]"
                          value={gridRow.days}
                          onChange={(event) =>
                            setGridRows((previous) =>
                              previous.map((r) =>
                                r.id === gridRow.id ? { ...r, days: event.target.value } : r,
                              ),
                            )
                          }
                        />
                        <span className="text-xs text-steel">day</span>
                        <button
                          type="button"
                          aria-label={`Remove ${rowTitle(gridRow)} row`}
                          title="Remove row"
                          className="ml-1 rounded-md p-1 text-steel transition-colors hover:bg-notcovered-soft hover:text-notcovered"
                          onClick={() =>
                            setGridRows((previous) => previous.filter((r) => r.id !== gridRow.id))
                          }
                        >
                          <X className="size-3.5" />
                        </button>
                      </div>
                    </TCell>
                    {TIERS.map((tier) => {
                      const key = `${gridRow.id}|${tier.tier}`;
                      return (
                        <TCell key={key} className="px-1.5 py-1.5">
                          <Input
                            aria-label={`${rowTitle(gridRow)}, ${tier.label}`}
                            placeholder="—"
                            className="text-data h-8 w-16 px-2 text-[13px]"
                            value={grid[key] ?? ""}
                            onChange={(event) =>
                              setGrid((previous) => ({ ...previous, [key]: event.target.value }))
                            }
                          />
                        </TCell>
                      );
                    })}
                  </TRow>
                ))}
              </TBody>
            </Table>
          </div>
          <div>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => {
                setGridRows((previous) => [
                  ...previous,
                  { id: nextRowId, channel: "preferred_retail", days: "" },
                ]);
                setNextRowId((n) => n + 1);
              }}
            >
              Add pricing row
            </Button>
          </div>
          <p className="text-xs text-steel">
            Each row is a channel and its fill length — type the days right in the table
            (30, 60, 90, 100…). Enter &quot;$10&quot;, &quot;$47.50&quot;, or &quot;50%&quot; per
            cell; leave a cell blank for no pricing row. Typed by a person on purpose: these are
            the dollar figures clients see.
          </p>
          {row.tierCostCount > 0 ? (
            <p className="text-xs text-steel">
              Prefilled from the <span className="text-data">{row.tierCostCount}</span> priced
              cells on file — saving replaces them with what the grid shows.
            </p>
          ) : null}
        </section>

        <div className="flex items-center justify-between">
          <Button onClick={handleSave} disabled={isPending}>
            {isPending ? "Saving…" : "Save"}
          </Button>
          <DeletePlanButton planId={plan.id} planName={plan.name} />
        </div>
      </CardContent>
    </Card>
  );
}
