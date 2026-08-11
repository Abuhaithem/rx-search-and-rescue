"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/sonner";
import { Table, TBody, TCell, TH, THead, TRow } from "@/components/ui/table";
import { upsertPlan, upsertTierCosts } from "@/server/actions/admin";
import type { PlanUpsertInput, TierCostRowInput } from "@/server/schemas";
import type { PlanCatalogRow } from "@/server/queries/plans";
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
  channel: Channel;
  daysSupply: number;
}

const rowKey = (row: GridRow) => `${row.channel}|${row.daysSupply}`;
const rowLabel = (row: GridRow) => `${CHANNEL_LABEL[row.channel]} — ${row.daysSupply} day`;

/** Documents vary: 30/90 is common but 60- and 100-day supplies exist too. */
const DEFAULT_ROWS: GridRow[] = [
  { channel: "preferred_retail", daysSupply: 30 },
  { channel: "standard_retail", daysSupply: 30 },
  { channel: "preferred_mail", daysSupply: 90 },
  { channel: "standard_mail", daysSupply: 90 },
];

const sortRows = (rows: GridRow[]): GridRow[] =>
  [...rows].sort((a, b) =>
    a.channel === b.channel
      ? a.daysSupply - b.daysSupply
      : CHANNEL_ORDER.indexOf(a.channel) - CHANNEL_ORDER.indexOf(b.channel),
  );

/** Grid rows come from the pricing on file; the classic four seed empty plans. */
function rowsFromCatalog(tierCosts: PlanCatalogRow["tierCosts"]): GridRow[] {
  const seen = new Map<string, GridRow>();
  for (const tc of tierCosts) {
    const row = { channel: tc.channel as Channel, daysSupply: tc.daysSupply };
    seen.set(rowKey(row), row);
  }
  return seen.size > 0 ? sortRows([...seen.values()]) : DEFAULT_ROWS;
}

const TIERS = [
  { tier: "t1", label: "T1" },
  { tier: "t2", label: "T2" },
  { tier: "t3", label: "T3" },
  { tier: "t4", label: "T4" },
  { tier: "t5", label: "T5" },
  { tier: "t6", label: "T6" },
  { tier: "insulin", label: "Insulin" },
] as const;

/** Existing DB rows → editable grid values ("$10", "50%"), keyed "channel|tier". */
function gridFromCatalog(tierCosts: PlanCatalogRow["tierCosts"]): Record<string, string> {
  const grid: Record<string, string> = {};
  for (const tc of tierCosts) {
    const display =
      tc.copayCents != null
        ? `$${centsToDollarInput(tc.copayCents)}`
        : tc.coinsurancePct != null
          ? `${tc.coinsurancePct % 1 === 0 ? tc.coinsurancePct.toFixed(0) : tc.coinsurancePct}%`
          : "";
    if (display) grid[`${tc.channel}|${tc.daysSupply}|${tc.tier}`] = display;
  }
  return grid;
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
  const [grid, setGrid] = useState<Record<string, string>>(() =>
    gridFromCatalog(row.tierCosts),
  );
  const [gridRows, setGridRows] = useState<GridRow[]>(() => rowsFromCatalog(row.tierCosts));
  const [newChannel, setNewChannel] = useState<Channel>("preferred_retail");
  const [newDays, setNewDays] = useState("");
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
    for (const gridRow of gridRows) {
      for (const tier of TIERS) {
        const raw = grid[`${rowKey(gridRow)}|${tier.tier}`] ?? "";
        const parsed = parseCell(raw);
        if (parsed === "invalid") {
          toast.error(
            `Can't read "${raw.trim()}" for ${rowLabel(gridRow)}, ${tier.label} — use "$10", "$47.50", or "50%"`,
          );
          return;
        }
        if (parsed == null) continue;
        tierCostRows.push({
          channel: gridRow.channel,
          tier: tier.tier,
          daysSupply: gridRow.daysSupply,
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

  return (
    <Card>
      <CardContent className="space-y-6 p-5">
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
                  <TRow key={rowKey(gridRow)} className="hover:bg-transparent">
                    <TCell className="whitespace-nowrap font-semibold">{rowLabel(gridRow)}</TCell>
                    {TIERS.map((tier) => {
                      const key = `${rowKey(gridRow)}|${tier.tier}`;
                      return (
                        <TCell key={key} className="px-1.5 py-1.5">
                          <Input
                            aria-label={`${rowLabel(gridRow)}, ${tier.label}`}
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
          <div className="flex flex-wrap items-center gap-2">
            <select
              aria-label="Channel for new pricing row"
              className="h-8 rounded-md border border-mist bg-white px-2 text-sm"
              value={newChannel}
              onChange={(event) => setNewChannel(event.target.value as Channel)}
            >
              {CHANNEL_ORDER.map((channel) => (
                <option key={channel} value={channel}>
                  {CHANNEL_LABEL[channel]}
                </option>
              ))}
            </select>
            <Input
              aria-label="Days supply for new pricing row"
              inputMode="numeric"
              placeholder="days, e.g. 60"
              className="text-data h-8 w-28"
              value={newDays}
              onChange={(event) => setNewDays(event.target.value)}
            />
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => {
                const days = Number((newDays.match(/\d+/) ?? [])[0]);
                if (!Number.isInteger(days) || days < 1 || days > 365) {
                  toast.error("Days supply is the fill length — e.g. 30, 60, 90, 100");
                  return;
                }
                const candidate: GridRow = { channel: newChannel, daysSupply: days };
                if (gridRows.some((r) => rowKey(r) === rowKey(candidate))) {
                  toast.error(`${rowLabel(candidate)} is already in the grid`);
                  return;
                }
                setGridRows((previous) => sortRows([...previous, candidate]));
                setNewDays("");
              }}
            >
              Add pricing row
            </Button>
          </div>
          <p className="text-xs text-steel">
            Enter &quot;$10&quot;, &quot;$47.50&quot;, or &quot;50%&quot; per cell — leave a cell
            blank for no pricing row. Supplies aren&apos;t fixed to 30/90 days — add a row for
            whatever fill length the Summary of Benefits prices (60-day, 100-day…). Typed by a
            person on purpose: these are the dollar figures clients see.
          </p>
          {row.tierCostCount > 0 ? (
            <p className="text-xs text-steel">
              Prefilled from the <span className="text-data">{row.tierCostCount}</span> priced
              cells on file — saving replaces them with what the grid shows.
            </p>
          ) : null}
        </section>

        <div>
          <Button onClick={handleSave} disabled={isPending}>
            {isPending ? "Saving…" : "Save"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
