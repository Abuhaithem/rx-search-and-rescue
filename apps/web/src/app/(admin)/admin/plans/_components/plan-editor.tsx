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
import type { TierCostRowInput } from "@/server/schemas";
import type { PlanCatalogRow } from "@/server/queries/plans";
import { centsToDollarInput, parseDollarsToCents } from "./money";
import { TierChecklist } from "./tier-checklist";

const CHANNELS = [
  { channel: "preferred_retail", daysSupply: 30, label: "Preferred retail — 30 day" },
  { channel: "standard_retail", daysSupply: 30, label: "Standard retail — 30 day" },
  { channel: "preferred_mail", daysSupply: 90, label: "Preferred mail — 90 day" },
  { channel: "standard_mail", daysSupply: 90, label: "Standard mail — 90 day" },
] as const;

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
    if (display) grid[`${tc.channel}|${tc.tier}`] = display;
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
  const [isPending, startTransition] = useTransition();

  function handleSave() {
    const premiumCents = parseDollarsToCents(premium);
    const rxDeductibleCents = parseDollarsToCents(deductible);
    if (Number.isNaN(premiumCents) || Number.isNaN(rxDeductibleCents)) {
      toast.error('Premium and deductible take dollars — e.g. "0", "12.40", "$275"');
      return;
    }

    const tierCostRows: TierCostRowInput[] = [];
    for (const channel of CHANNELS) {
      for (const tier of TIERS) {
        const raw = grid[`${channel.channel}|${tier.tier}`] ?? "";
        const parsed = parseCell(raw);
        if (parsed === "invalid") {
          toast.error(
            `Can't read "${raw.trim()}" for ${channel.label}, ${tier.label} — use "$10", "$47.50", or "50%"`,
          );
          return;
        }
        if (parsed == null) continue;
        tierCostRows.push({
          channel: channel.channel,
          tier: tier.tier,
          daysSupply: channel.daysSupply,
          copayCents: parsed.copayCents,
          coinsurancePct: parsed.coinsurancePct,
        });
      }
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
                      {tier.label}
                    </TH>
                  ))}
                </TRow>
              </THead>
              <TBody>
                {CHANNELS.map((channel) => (
                  <TRow key={channel.channel} className="hover:bg-transparent">
                    <TCell className="whitespace-nowrap font-semibold">{channel.label}</TCell>
                    {TIERS.map((tier) => {
                      const key = `${channel.channel}|${tier.tier}`;
                      return (
                        <TCell key={key} className="px-1.5 py-1.5">
                          <Input
                            aria-label={`${channel.label}, ${tier.label}`}
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
          <p className="text-xs text-steel">
            Enter &quot;$10&quot;, &quot;$47.50&quot;, or &quot;50%&quot; per cell — leave a cell
            blank for no pricing row. Typed by a person on purpose: these are the dollar figures
            clients see.
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
