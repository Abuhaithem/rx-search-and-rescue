import { notFound } from "next/navigation";
import { getIntake } from "@/server/queries/intake";
import { IntakeReview, type IntakeReviewProps } from "./_components/intake-review";

export const dynamic = "force-dynamic";

export default async function IntakeReviewPage({
  params,
}: {
  params: Promise<{ clientId: string }>;
}) {
  const { clientId } = await params;
  const intake = await getIntake(clientId);
  if (!intake) notFound();

  const currentYear = new Date().getFullYear();
  // AEP (October onward) work targets next plan year.
  const defaultPlanYear = new Date().getMonth() >= 9 ? currentYear + 1 : currentYear;

  const props: IntakeReviewProps = {
    clientId,
    sourcePdfUrl: intake.sourcePdfUrl,
    hasSourcePdf: intake.client.sourceRxcPath != null,
    defaultPlanYear,
    client: {
      fullName: intake.client.fullName,
      externalId: intake.client.externalId,
      zip: intake.client.zip,
      state: intake.client.state,
      county: intake.client.county,
      takesPrescriptions: intake.client.takesPrescriptions,
      deliveryPreferred: intake.client.deliveryPreferred,
      mailOrderInterest: intake.client.mailOrderInterest,
    },
    medications: intake.medications.map((m) => ({
      id: m.id,
      name: m.name,
      dosageText: m.dosageText,
      rxcui: m.rxcui,
      strength: m.strength,
      form: m.form,
      quantity: m.quantity,
      daysSupply: m.daysSupply,
      genericOk: m.genericOk,
      prn: m.prn,
      rawText: m.rawText,
      source: m.source,
      confidence: m.confidence === null ? null : Number(m.confidence),
      confirmed: m.confirmed,
    })),
    pharmacies: intake.pharmacies.map((p) => ({
      id: p.id,
      rank: p.rank,
      rawText: p.rawText,
      pharmacyId: p.pharmacyId,
      matchConfidence: p.matchConfidence === null ? null : Number(p.matchConfidence),
      confirmed: p.confirmed,
      pharmacyName: p.pharmacy?.name ?? null,
    })),
    policies: intake.policies.map((p) => ({
      id: p.id,
      rawText: p.rawText,
      carrierName: p.carrierName,
      policyNumber: p.policyNumber,
      policyType: p.policyType,
      isCurrentDrugPlan: p.isCurrentDrugPlan,
      matchedPlanId: p.matchedPlanId,
    })),
  };

  // Remount when the ingestion lands (name + medications appear) so extracted
  // rows replace the empty editing state.
  return <IntakeReview key={`${intake.client.fullName}:${intake.medications.length}`} {...props} />;
}
