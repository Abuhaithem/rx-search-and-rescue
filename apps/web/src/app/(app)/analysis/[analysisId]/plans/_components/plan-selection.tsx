"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { Cents, NetworkStatus } from "@rxsr/core";
import { runComparison, selectPlans } from "@/server/actions/analysis";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/sonner";
import { PageHeader } from "@/components/domain/page-header";
import { WorkflowNav } from "@/components/domain/workflow-nav";
import { PlanCard } from "@/components/domain/plan-card";

export interface SelectablePlan {
  planId: string;
  planName: string;
  carrierName: string;
  premiumCents: Cents | null;
  rxDeductibleCents: Cents | null;
  formularyStatus: "active" | "missing" | "stale";
  pharmacyStatus: NetworkStatus | null;
  tierCostsComplete: boolean;
  isCurrent: boolean;
}

interface PlanSelectionProps {
  analysisId: string;
  clientId: string;
  clientName: string;
  zip: string | null;
  county: string | null;
  planYear: number;
  pharmacyName: string | null;
  plans: SelectablePlan[];
  initialSelected: string[];
  locked: boolean;
}

const MAX_PLANS = 5;

export function PlanSelection({
  analysisId,
  clientId,
  clientName,
  zip,
  county,
  planYear,
  pharmacyName,
  plans,
  initialSelected,
  locked,
}: PlanSelectionProps) {
  const router = useRouter();
  const [selected, setSelected] = useState<string[]>(initialSelected);
  const [pending, startTransition] = useTransition();

  const warningFor = (plan: SelectablePlan): { label: string; message: string } | undefined => {
    if (plan.formularyStatus === "missing") return { label: `${planYear} formulary`, message: "Missing" };
    if (plan.formularyStatus === "stale") return { label: `${planYear} formulary`, message: "Stale" };
    if (!plan.tierCostsComplete) return { label: "Tier costs", message: "Incomplete" };
    return undefined;
  };

  const toggle = (planId: string, next: boolean) => {
    setSelected((prev) => {
      if (!next) return prev.filter((id) => id !== planId);
      if (prev.includes(planId)) return prev;
      if (prev.length >= MAX_PLANS) {
        toast.error(`Up to ${MAX_PLANS} plans can be compared`);
        return prev;
      }
      return [...prev, planId];
    });
  };

  const run = () => {
    if (selected.length < 1) {
      toast.error("Select at least one plan");
      return;
    }
    startTransition(async () => {
      const selection = await selectPlans(analysisId, selected, planYear);
      if (!selection.ok) {
        toast.error(selection.error);
        return;
      }
      const comparison = await runComparison(analysisId);
      if (!comparison.ok) {
        toast.error(comparison.error);
        return;
      }
      router.push(`/analysis/${analysisId}`);
    });
  };

  const location =
    zip !== null
      ? `ZIP ${zip}${county ? ` (${county} County)` : ""}`
      : "the client's area (no ZIP on file)";

  return (
    <div className="space-y-6">
      <WorkflowNav analysisId={analysisId} clientId={clientId} current="plans" />
      <PageHeader
        title={`Select Plans — ${clientName}`}
        actions={
          <Button
            variant="rescue"
            onClick={run}
            disabled={pending || locked || selected.length < 1}
            className={pending ? "opacity-70" : undefined}
          >
            {pending ? "Running…" : "Run Comparison →"}
          </Button>
        }
      />

      <p className="text-sm text-steel">
        Plans available in {location} — plan year{" "}
        <span className="text-data font-semibold text-deepwater">{planYear}</span> ·{" "}
        <span className="font-semibold text-deepwater">
          {selected.length} of {MAX_PLANS} selected
        </span>
        {pharmacyName ? (
          <>
            {" "}
            · Client&rsquo;s pharmacy: <span className="font-semibold text-deepwater">{pharmacyName}</span>
          </>
        ) : null}
      </p>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {plans.map((plan) => {
          const warning = warningFor(plan);
          return (
            <PlanCard
              key={plan.planId}
              planName={plan.isCurrent ? `${plan.planName} (${planYear})` : plan.planName}
              carrier={plan.carrierName}
              premiumCents={plan.premiumCents ?? 0}
              rxDeductibleCents={plan.rxDeductibleCents ?? 0}
              selected={selected.includes(plan.planId)}
              onSelectedChange={(next) => toggle(plan.planId, next)}
              isCurrentPlan={plan.isCurrent}
              disabled={locked || warning !== undefined}
              pharmacyName={pharmacyName ?? undefined}
              pharmacyStatus={plan.pharmacyStatus ?? undefined}
              warning={warning}
            />
          );
        })}
      </div>

      {plans.length === 0 ? (
        <p className="text-sm text-steel">
          No curated plans for plan year {planYear} in this service area yet — an admin can add
          plans and formularies under Admin.
        </p>
      ) : (
        <p className="text-xs text-steel">
          Pharmacy status is matched automatically against each carrier&rsquo;s pharmacy list and
          can be corrected by an admin. Plans with a missing or stale formulary can&rsquo;t be
          compared yet.
        </p>
      )}
    </div>
  );
}
