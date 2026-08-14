import { notFound } from "next/navigation";
import { getComparison } from "@/server/queries/comparison";
import { getAvailablePlans } from "@/server/queries/plans";
import { PlanSelection, type SelectablePlan } from "./_components/plan-selection";

export const dynamic = "force-dynamic";

export default async function SelectPlansPage({
  params,
}: {
  params: Promise<{ analysisId: string }>;
}) {
  const { analysisId } = await params;
  const comparison = await getComparison(analysisId);
  if (!comparison) notFound();

  const cards = await getAvailablePlans(comparison.client.id, comparison.analysis.planYear);

  const plans: SelectablePlan[] = [...cards]
    .sort((a, b) => Number(b.isCurrent) - Number(a.isCurrent))
    .map((card) => ({
      planId: card.plan.id,
      planName: card.plan.name,
      carrierName: card.carrierName,
      premiumCents: card.premiumCents,
      rxDeductibleCents: card.rxDeductibleCents,
      formularyStatus: card.formularyStatus,
      pharmacyStatus: card.pharmacyStatus,
      tierCostsComplete: card.tierCostsComplete,
      isCurrent: card.isCurrent,
    }));

  return (
    <PlanSelection
      analysisId={analysisId}
      clientId={comparison.client.id}
      clientName={comparison.client.fullName}
      zip={comparison.client.zip}
      county={comparison.client.county}
      planYear={comparison.analysis.planYear}
      pharmacyName={comparison.primaryPharmacy?.name ?? null}
      plans={plans}
      // Fresh analysis: the client's matched current plan starts selected so
      // the comparison always has its "current plan" column.
      initialSelected={
        comparison.plans.length > 0
          ? comparison.plans.map((p) => p.plan.id)
          : plans.filter((p) => p.isCurrent).map((p) => p.planId)
      }
      locked={
        comparison.analysis.status === "approved" || comparison.analysis.status === "delivered"
      }
    />
  );
}
