"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { Loader2, Plus, TriangleAlert, X } from "lucide-react";
import { LIS_CATEGORIES, LIS_CATEGORY_LABELS, type LisCategory, type PolicyType } from "@rxsr/core";
import { confirmIntake, retryRxcExtraction } from "@/server/actions/intake";
import type { ConfirmIntakeInput } from "@/server/schemas";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "@/components/ui/sonner";
import { PageHeader } from "@/components/domain/page-header";
import { PdfPane } from "@/components/domain/pdf-pane";
import { Table, TBody, TCell, TH, THead, TRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { PharmacyCombobox, type PharmacySelection } from "./pharmacy-combobox";

export interface IntakeMedication {
  id?: string;
  name: string;
  dosageText: string | null;
  rxcui: string | null;
  strength: string | null;
  form: string | null;
  quantity: number | null;
  daysSupply: number | null;
  genericOk: boolean;
  prn: boolean;
  rawText: string;
  source: "structured" | "freetext" | "manual";
  confidence: number | null;
  confirmed: boolean;
}

export interface IntakePharmacy {
  id?: string;
  rank: number;
  rawText: string;
  pharmacyId: string | null;
  matchConfidence: number | null;
  confirmed: boolean;
  pharmacyName: string | null;
}

export interface IntakePolicy {
  id?: string;
  rawText: string;
  carrierName: string | null;
  policyNumber: string | null;
  policyType: PolicyType;
  /** Catalog plan the policy text matched (deterministic; agent confirms). */
  suggestedPlanId: string | null;
  isCurrentDrugPlan: boolean;
  matchedPlanId: string | null;
}

export interface IntakeReviewProps {
  clientId: string;
  sourcePdfUrl: string | null;
  hasSourcePdf: boolean;
  /** Latest extraction job state: queued | running | done | failed; null = no job. */
  ingestionStatus: string | null;
  ingestionError: string | null;
  defaultPlanYear: number;
  client: {
    fullName: string;
    externalId: string | null;
    zip: string | null;
    state: string | null;
    county: string | null;
    takesPrescriptions: boolean | null;
    deliveryPreferred: boolean | null;
    mailOrderInterest: string | null;
    /** CMS dual/LIS category; null = not LIS / unknown. */
    lisCategory: LisCategory | null;
  };
  medications: IntakeMedication[];
  pharmacies: IntakePharmacy[];
  policies: IntakePolicy[];
  /** Curated catalog plans for the year — options for the current-plan match. */
  planOptions: { id: string; label: string }[];
}

interface MedicationRowState extends IntakeMedication {
  key: string;
}

const LOW_CONFIDENCE = 0.8;

const needsReview = (med: IntakeMedication): boolean =>
  !med.confirmed &&
  med.source !== "manual" &&
  (med.source === "freetext" || (med.confidence !== null && med.confidence < LOW_CONFIDENCE));

let nextKey = 0;
const makeKey = () => `med-${nextKey++}`;

export function IntakeReview(props: IntakeReviewProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [fullName, setFullName] = useState(props.client.fullName);
  const [zip, setZip] = useState(props.client.zip ?? "");
  const [county, setCounty] = useState(props.client.county ?? "");
  // Legacy "ask_client" rows collapse to "no" — the option no longer exists.
  const [mailOrderInterest, setMailOrderInterest] = useState(
    props.client.mailOrderInterest === "yes" ? "yes" : "no",
  );
  const [lisCategory, setLisCategory] = useState<string>(props.client.lisCategory ?? "none");
  const [planYear, setPlanYear] = useState(props.defaultPlanYear);
  const [currentPolicyId, setCurrentPolicyId] = useState<string>(
    props.policies.find((p) => p.isCurrentDrugPlan)?.id ?? "none",
  );
  const matchForPolicy = (policyId: string): string => {
    const policy = props.policies.find((p) => p.id === policyId);
    return policy?.matchedPlanId ?? policy?.suggestedPlanId ?? "none";
  };
  const [matchedPlanId, setMatchedPlanId] = useState<string>(() =>
    matchForPolicy(props.policies.find((p) => p.isCurrentDrugPlan)?.id ?? "none"),
  );
  const selectCurrentPolicy = (policyId: string) => {
    setCurrentPolicyId(policyId);
    setMatchedPlanId(matchForPolicy(policyId));
  };
  const currentSuggestion =
    props.policies.find((p) => p.id === currentPolicyId)?.suggestedPlanId ?? null;
  const rankOne = props.pharmacies.find((p) => p.rank === 1) ?? props.pharmacies[0] ?? null;
  const [pharmacySelection, setPharmacySelection] = useState<PharmacySelection>({
    label: rankOne?.pharmacyName ?? rankOne?.rawText ?? "",
    pharmacyId: rankOne?.pharmacyId ?? null,
  });
  // Flips once the agent picks from the combobox — an explicit selection
  // outranks the extraction's match confidence.
  const [pharmacyTouched, setPharmacyTouched] = useState(false);
  const [medications, setMedications] = useState<MedicationRowState[]>(() =>
    props.medications.map((m) => ({ ...m, key: makeKey() })),
  );

  // Ingestion in progress: no medications yet, a PDF exists, and the job
  // hasn't failed. A failed job renders an error card instead of polling.
  const extractionFailed = props.ingestionStatus === "failed";
  const reading = props.medications.length === 0 && props.hasSourcePdf && !extractionFailed;
  useEffect(() => {
    if (!reading) return;
    const timer = setInterval(() => router.refresh(), 3000);
    return () => clearInterval(timer);
  }, [reading, router]);

  const [retrying, startRetry] = useTransition();
  const handleRetry = () => {
    startRetry(async () => {
      const result = await retryRxcExtraction(props.clientId);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      router.refresh();
    });
  };

  const drugPlanPolicies = props.policies.filter((p) => p.policyType !== "med_supp");
  const medSuppPolicies = props.policies.filter((p) => p.policyType === "med_supp");

  const reviewMeds = useMemo(() => medications.filter((m) => needsReview(m)), [medications]);

  const pharmacyUnconfirmed =
    pharmacySelection.label.trim() !== "" &&
    (pharmacySelection.pharmacyId === null ||
      (!pharmacyTouched &&
        rankOne !== null &&
        !rankOne.confirmed &&
        rankOne.matchConfidence !== null &&
        rankOne.matchConfidence < LOW_CONFIDENCE));

  const updateMedication = (key: string, patch: Partial<MedicationRowState>) => {
    setMedications((meds) => meds.map((m) => (m.key === key ? { ...m, ...patch } : m)));
  };

  const addMedication = () => {
    setMedications((meds) => [
      ...meds,
      {
        key: makeKey(),
        name: "",
        dosageText: null,
        rxcui: null,
        strength: null,
        form: null,
        quantity: null,
        daysSupply: null,
        genericOk: true,
        prn: false,
        rawText: "",
        source: "manual",
        confidence: null,
        confirmed: true,
      },
    ]);
  };

  const submit = () => {
    if (!fullName.trim()) {
      toast.error("Client name is required");
      return;
    }
    if (zip.trim() && !/^\d{5}$/.test(zip.trim())) {
      toast.error("ZIP must be 5 digits");
      return;
    }
    if (medications.length === 0) {
      toast.error("Add at least one medication before confirming");
      return;
    }
    if (medications.some((m) => !m.name.trim())) {
      toast.error("Every medication row needs a name");
      return;
    }

    const payload: ConfirmIntakeInput = {
      client: {
        fullName: fullName.trim(),
        externalId: props.client.externalId,
        zip: zip.trim() || null,
        state: props.client.state,
        county: county.trim() || null,
        takesPrescriptions: props.client.takesPrescriptions,
        deliveryPreferred: props.client.deliveryPreferred,
        lisCategory:
          lisCategory === "none" ? null : (lisCategory as LisCategory),
        mailOrderInterest:
          mailOrderInterest === "yes" || mailOrderInterest === "no"
            ? mailOrderInterest
            : null,
      },
      planYear,
      medications: medications.map((m, index) => ({
        id: m.id,
        name: m.name.trim(),
        dosageText: m.dosageText?.trim() || null,
        rxcui: m.rxcui,
        strength: m.strength,
        form: m.form,
        quantity: m.quantity,
        daysSupply: m.daysSupply,
        genericOk: m.genericOk,
        prn: m.prn,
        position: index,
        rawText: m.rawText || m.name.trim(),
      })),
      pharmacies: pharmacySelection.label.trim()
        ? [
            {
              id: rankOne?.id,
              rank: 1,
              rawText: pharmacySelection.label.trim(),
              pharmacyId: pharmacySelection.pharmacyId,
            },
            ...props.pharmacies
              .filter((p) => p !== rankOne)
              .map((p) => ({ id: p.id, rank: p.rank, rawText: p.rawText, pharmacyId: p.pharmacyId })),
          ]
        : [],
      policies: props.policies.map((p) => ({
        id: p.id,
        rawText: p.rawText,
        carrierName: p.carrierName,
        policyNumber: p.policyNumber,
        policyType: p.policyType,
        isCurrentDrugPlan: p.id === currentPolicyId,
        matchedPlanId:
          p.id === currentPolicyId
            ? matchedPlanId === "none"
              ? null
              : matchedPlanId
            : p.matchedPlanId,
      })),
    };

    startTransition(async () => {
      const result = await confirmIntake(props.clientId, payload);
      if (result.ok) {
        router.push(`/analysis/${result.data.analysisId}/plans`);
      } else {
        toast.error(result.error);
      }
    });
  };

  const actions = (
    <>
      <Button asChild variant="secondary" className={pending ? "pointer-events-none opacity-50" : undefined}>
        <Link href="/dashboard">Cancel</Link>
      </Button>
      <Button onClick={submit} disabled={pending} className={pending ? "opacity-70" : undefined}>
        {pending ? "Confirming…" : "Confirm & Select Plans →"}
      </Button>
    </>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        backHref="/dashboard"
        title={`Intake Review — ${fullName || "New client"}`}
        actions={actions}
      />

      <Card>
        <div className="grid lg:grid-cols-[minmax(320px,400px)_1fr] lg:items-start">
          <div className="overflow-hidden rounded-t-card border-b border-mist/60 lg:sticky lg:top-24 lg:self-start lg:rounded-l-card lg:rounded-tr-none lg:border-b-0 lg:border-r">
            <PdfPane
              src={props.sourcePdfUrl ?? ""}
              sourceLabel={props.hasSourcePdf ? `${fullName} — AgencyBloc RxC.pdf` : undefined}
            />
          </div>

          <div className="min-w-0 space-y-6 p-6">
            <section className="space-y-3">
              <h2 className="font-display text-base font-extrabold text-deepwater">
                Client Information
              </h2>
              <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
                <div className="space-y-1">
                  <Label htmlFor="client-name" className="text-xs text-steel">
                    Client
                  </Label>
                  <Input
                    id="client-name"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    className="w-44 font-semibold"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="client-zip" className="text-xs text-steel">
                    ZIP
                  </Label>
                  <Input
                    id="client-zip"
                    value={zip}
                    onChange={(e) => setZip(e.target.value)}
                    inputMode="numeric"
                    maxLength={5}
                    className="w-24 text-data"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="client-county" className="text-xs text-steel">
                    County
                  </Label>
                  <Input
                    id="client-county"
                    value={county}
                    onChange={(e) => setCounty(e.target.value)}
                    placeholder="Multi-county ZIP? Confirm"
                    className="w-36"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-steel">Current plan</Label>
                  <Select value={currentPolicyId} onValueChange={selectCurrentPolicy}>
                    <SelectTrigger className="w-56">
                      <SelectValue placeholder="Select current drug plan" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">No current drug plan</SelectItem>
                      {drugPlanPolicies.map((p) =>
                        p.id ? (
                          <SelectItem key={p.id} value={p.id}>
                            {p.carrierName ? `${p.carrierName} — ${p.rawText}` : p.rawText}
                          </SelectItem>
                        ) : null,
                      )}
                    </SelectContent>
                  </Select>
                </div>
                {currentPolicyId !== "none" ? (
                  <div className="space-y-1">
                    <Label className="text-xs text-steel">
                      In our catalog
                      {matchedPlanId !== "none" && matchedPlanId === currentSuggestion ? (
                        <span className="ml-1.5 rounded-chip bg-covered-soft px-1.5 py-0.5 text-[10px] font-semibold text-covered">
                          auto-matched
                        </span>
                      ) : null}
                    </Label>
                    <Select value={matchedPlanId} onValueChange={setMatchedPlanId}>
                      <SelectTrigger className="w-64">
                        <SelectValue placeholder="Match to a catalog plan" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Not in catalog</SelectItem>
                        {props.planOptions.map((option) => (
                          <SelectItem key={option.id} value={option.id}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ) : null}
                <div className="space-y-1">
                  <Label className="text-xs text-steel">Plan year</Label>
                  <Select value={String(planYear)} onValueChange={(v) => setPlanYear(Number(v))}>
                    <SelectTrigger className="w-28 text-data">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {[props.defaultPlanYear - 1, props.defaultPlanYear, props.defaultPlanYear + 1].map(
                        (y) => (
                          <SelectItem key={y} value={String(y)}>
                            {y}
                          </SelectItem>
                        ),
                      )}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
                <div className="space-y-1">
                  <Label className="text-xs text-steel">Preferred pharmacy</Label>
                  <div className="flex items-center gap-2">
                    <PharmacyCombobox
                      value={pharmacySelection}
                      invalid={pharmacyUnconfirmed}
                      clientZip={/^\d{5}$/.test(zip.trim()) ? zip.trim() : null}
                      onChange={(selection) => {
                        setPharmacySelection(selection);
                        setPharmacyTouched(true);
                      }}
                    />
                    {pharmacySelection.label.trim() ? (
                      pharmacyUnconfirmed ? (
                        <span className="inline-flex items-center gap-1 rounded-chip bg-restricted-soft px-2 py-0.5 text-xs font-semibold text-restricted">
                          <TriangleAlert className="size-3" />
                          No pharmacy on file matched
                        </span>
                      ) : (
                        <span className="inline-flex items-center rounded-chip bg-covered-soft px-2 py-0.5 text-xs font-semibold text-covered">
                          {pharmacyTouched ? "Linked ✓" : "from Rx Collect ✓"}
                        </span>
                      )
                    ) : null}
                  </div>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-steel">Mail order interest</Label>
                  <Select value={mailOrderInterest} onValueChange={setMailOrderInterest}>
                    <SelectTrigger className="w-36">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="yes">Yes</SelectItem>
                      <SelectItem value="no">No</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-steel">Medicaid / Extra Help (LIS)</Label>
                  <Select value={lisCategory} onValueChange={setLisCategory}>
                    <SelectTrigger className="w-64">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Not LIS / unknown</SelectItem>
                      {LIS_CATEGORIES.map((category) => (
                        <SelectItem key={category} value={category}>
                          {LIS_CATEGORY_LABELS[category]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {medSuppPolicies.length > 0 ? (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs text-steel">Med Supp (context):</span>
                  {medSuppPolicies.map((p, i) => (
                    <span
                      key={p.id ?? i}
                      className="inline-flex items-center rounded-chip bg-fog px-2 py-0.5 text-xs font-semibold text-steel"
                    >
                      {p.carrierName ?? p.rawText}
                    </span>
                  ))}
                </div>
              ) : null}
            </section>

            <section className="space-y-3">
              <h2 className="font-display text-base font-extrabold text-deepwater">
                Medications {props.hasSourcePdf ? "(read from PDF)" : ""}
              </h2>

              {medications.length === 0 && extractionFailed ? (
                <div className="space-y-3 rounded-card border border-notcovered/40 bg-notcovered-soft px-4 py-5 text-sm">
                  <p className="font-semibold text-notcovered">PDF extraction failed</p>
                  {props.ingestionError ? (
                    <p className="text-data text-xs text-deepwater/80">{props.ingestionError}</p>
                  ) : null}
                  <div className="flex items-center gap-3">
                    <Button variant="secondary" size="sm" onClick={handleRetry} disabled={retrying}>
                      {retrying ? "Retrying…" : "Retry extraction"}
                    </Button>
                    <span className="text-xs text-steel">or add medication rows manually below.</span>
                  </div>
                </div>
              ) : medications.length === 0 && reading ? (
                <div className="flex items-center gap-2 rounded-card border border-mist bg-fog px-4 py-6 text-sm text-steel">
                  <Loader2 className="size-4 animate-spin" />
                  Reading PDF… extracted medications will appear here.
                </div>
              ) : medications.length === 0 ? (
                <div className="rounded-card border border-dashed border-mist px-4 py-6 text-sm text-steel">
                  No medications yet — add rows manually.
                </div>
              ) : (
                <div className="rounded-card border border-mist/60">
                  <Table>
                    <THead>
                      <tr>
                        <TH>Medication</TH>
                        <TH>Dosage</TH>
                        <TH className="w-20">Qty</TH>
                        <TH className="w-24">Refill</TH>
                        <TH className="w-24">Generic OK</TH>
                        <TH className="w-10" />
                      </tr>
                    </THead>
                    <TBody>
                      {medications.map((med) => (
                        <TRow
                          key={med.key}
                          className={cn(needsReview(med) && "bg-restricted-soft/40 hover:bg-restricted-soft/60")}
                        >
                          <TCell>
                            <Input
                              value={med.name}
                              onChange={(e) => updateMedication(med.key, { name: e.target.value })}
                              aria-label="Medication name"
                              className="h-8 w-40 font-semibold"
                            />
                          </TCell>
                          <TCell>
                            <Input
                              value={med.dosageText ?? ""}
                              onChange={(e) =>
                                updateMedication(med.key, { dosageText: e.target.value || null })
                              }
                              aria-label="Dosage"
                              className="h-8 w-48 text-steel"
                            />
                          </TCell>
                          <TCell>
                            <Input
                              value={med.quantity ?? ""}
                              onChange={(e) => {
                                const n = Number.parseInt(e.target.value, 10);
                                updateMedication(med.key, {
                                  quantity: Number.isInteger(n) && n > 0 ? n : null,
                                });
                              }}
                              inputMode="numeric"
                              aria-label="Quantity"
                              className="h-8 w-16 text-data"
                            />
                          </TCell>
                          <TCell>
                            <div className="flex items-center gap-1">
                              <Input
                                value={med.daysSupply ?? ""}
                                onChange={(e) => {
                                  const n = Number.parseInt(e.target.value, 10);
                                  updateMedication(med.key, {
                                    daysSupply: Number.isInteger(n) && n > 0 ? n : null,
                                  });
                                }}
                                inputMode="numeric"
                                aria-label="Refill days"
                                className="h-8 w-16 text-data"
                              />
                              <span className="text-xs text-steel">days</span>
                            </div>
                          </TCell>
                          <TCell>
                            <Checkbox
                              checked={med.genericOk}
                              onCheckedChange={(checked) =>
                                updateMedication(med.key, { genericOk: checked === true })
                              }
                              aria-label="Generic OK"
                            />
                          </TCell>
                          <TCell>
                            <button
                              type="button"
                              onClick={() =>
                                setMedications((meds) => meds.filter((m) => m.key !== med.key))
                              }
                              aria-label={`Remove ${med.name || "medication"}`}
                              className="rounded-md p-1 text-steel transition-colors hover:bg-fog hover:text-notcovered"
                            >
                              <X className="size-4" />
                            </button>
                          </TCell>
                        </TRow>
                      ))}
                    </TBody>
                  </Table>
                </div>
              )}

              {reviewMeds.length > 0 ? (
                <div className="rounded-card border border-restricted/50 bg-restricted-soft px-4 py-3 text-sm text-restricted">
                  <div className="flex items-center gap-1.5 font-semibold">
                    <TriangleAlert className="size-4" />
                    Needs review — extra notes found on the form:
                  </div>
                  <div className="mt-1">
                    &ldquo;{reviewMeds.map((m) => m.rawText || m.name).join(" · ")}&rdquo;
                  </div>
                  <div className="mt-1 font-semibold">
                    → Confirm or edit the highlighted rows before continuing
                  </div>
                </div>
              ) : null}

              <Button variant="ghost" size="sm" onClick={addMedication}>
                <Plus />
                Add medication
              </Button>
            </section>

            <div className="flex justify-end gap-2 border-t border-mist/60 pt-4">{actions}</div>
          </div>
        </div>
      </Card>
    </div>
  );
}
