/**
 * RxC intake: download the uploaded RxC PDF, parse it DETERMINISTICALLY from
 * the text layer (lib/rxc-parse — the RxC layout is consistent, and this
 * keeps PHI off every LLM vendor), resolve preferred pharmacies against the
 * pharmacies table, classify in-force policies, and land everything
 * unconfirmed (agents flip `confirmed` on the review screen).
 * The LLM provider's extractRxc runs ONLY as a fallback when the
 * deterministic parse fails (layout drift, scanned PDF with no text layer);
 * its rows are capped at confidence 0.7 so they surface amber in the UI.
 */
import {
  clientMedications,
  clientPharmacies,
  clients,
  eq,
  inForcePolicies,
} from "@rxsr/db";
import { matchPharmacy, parsePharmacyText } from "@rxsr/core/pharmacy";
import type { ExtractedPolicy, RxcExtraction } from "@rxsr/core/intake";
import type { RxcIntakeJob } from "../queues";
import { markJobDone, markJobFailed, markJobRunning, updateJobProgress } from "../lib/db";
import { parseDosageText } from "../lib/dosage";
import { parseRxcText } from "../lib/rxc-parse";
import { resolveDrugNames } from "../lib/drug-resolution";
import {
  candidateFromPharmacyRow,
  loadZipCandidates,
  pharmacyResolutionPrompt,
} from "../lib/pharmacies";
import { createJobDeps, type JobDeps } from "./deps";

/** Single best drug plan: pdp beats ma_pd; med_supp/other never qualify. */
export function pickCurrentDrugPlanIndex(policies: ExtractedPolicy[]): number {
  const pdp = policies.findIndex((p) => p.policyType === "pdp");
  if (pdp !== -1) return pdp;
  return policies.findIndex((p) => p.policyType === "ma_pd");
}

export type RxcParseMethod = "deterministic" | "llm_fallback";

/** LLM-extracted rows are never trusted above this (amber in the UI). */
export const LLM_FALLBACK_MAX_CONFIDENCE = 0.7;

export interface RxcResolution {
  extraction: RxcExtraction;
  parseMethod: RxcParseMethod;
}

/**
 * Deterministic-first: the text-layer parser keeps PHI off LLM vendors.
 * Any failure (missing anchors, zod gate, no text layer) falls back to the
 * provider's extractRxc with confidence capped at LLM_FALLBACK_MAX_CONFIDENCE.
 */
export async function resolveRxcExtraction(
  deps: Pick<JobDeps, "pdf" | "extractor">,
  pdfBytes: Uint8Array,
): Promise<RxcResolution> {
  try {
    const textLayer = await deps.pdf.extractPageTexts(pdfBytes);
    return {
      extraction: parseRxcText(textLayer.pages),
      parseMethod: "deterministic",
    };
  } catch {
    const extraction = await deps.extractor.extractRxc(
      Buffer.from(pdfBytes).toString("base64"),
    );
    return {
      extraction: {
        ...extraction,
        medications: extraction.medications.map((medication) => ({
          ...medication,
          confidence: Math.min(medication.confidence, LLM_FALLBACK_MAX_CONFIDENCE),
        })),
      },
      parseMethod: "llm_fallback",
    };
  }
}

export async function runRxcIntake(
  job: RxcIntakeJob,
  deps: JobDeps = createJobDeps(),
): Promise<void> {
  const { db } = deps;
  await markJobRunning(db, job.ingestionJobId);
  try {
    await updateJobProgress(db, job.ingestionJobId, { message: "Downloading RxC PDF" });
    const pdfBytes = await deps.storage.download(job.storagePath);

    await updateJobProgress(db, job.ingestionJobId, { message: "Parsing RxC export" });
    const { extraction, parseMethod } = await resolveRxcExtraction(deps, pdfBytes);

    await updateJobProgress(db, job.ingestionJobId, {
      message: `Saving client details (parse_method=${parseMethod})`,
    });
    await db
      .update(clients)
      .set({
        fullName: extraction.clientName,
        zip: extraction.zip,
        takesPrescriptions: extraction.takesPrescriptions,
        deliveryPreferred: extraction.deliveryPreferred,
        updatedAt: new Date(),
      })
      .where(eq(clients.id, job.clientId));

    const drugResolutionSummary = await insertMedications(deps, job, extraction);
    await insertPharmacies(deps, job, extraction);
    await insertPolicies(deps, job, extraction);

    await markJobDone(db, job.ingestionJobId, {
      message: `Extracted ${extraction.medications.length} medications (drug names: ${drugResolutionSummary || "none"}), ${extraction.preferredPharmacies.length} pharmacies, ${extraction.inForcePolicies.length} policies (parse_method=${parseMethod})`,
    });
  } catch (error) {
    await markJobFailed(db, job.ingestionJobId, error);
    throw error;
  }
}

async function insertMedications(
  deps: JobDeps,
  job: RxcIntakeJob,
  extraction: RxcExtraction,
): Promise<string> {
  const { db } = deps;
  await updateJobProgress(db, job.ingestionJobId, {
    message: `Resolving ${extraction.medications.length} drug names`,
  });

  // Brand → generic resolution ladder (exact/alias/fuzzy, then one batched
  // LLM call for the leftovers). Runs here — at ingestion — never at
  // analysis time.
  const resolutions = await resolveDrugNames(
    db,
    deps.extractor,
    extraction.medications.map((m) => m.name),
  );

  await updateJobProgress(db, job.ingestionJobId, {
    message: `Saving ${extraction.medications.length} medications`,
  });

  const rows: (typeof clientMedications.$inferInsert)[] = [];
  for (const [index, medication] of extraction.medications.entries()) {
    const dosage = parseDosageText(medication.dosageText);
    const resolution = resolutions.get(medication.name);
    rows.push({
      clientId: job.clientId,
      rawText: medication.rawText,
      name: medication.name,
      dosageText: medication.dosageText,
      rxcui: null,
      strength: dosage.strength,
      form: dosage.form,
      quantity: medication.quantity,
      daysSupply: medication.daysSupply,
      genericOk: medication.genericOk ?? true,
      prn: medication.prn,
      resolvedGenericName: resolution?.genericKey ?? null,
      resolutionMethod: resolution?.path ?? null,
      source: medication.source,
      confidence: medication.confidence.toFixed(3),
      confirmed: false,
      position: index,
    });
  }

  // Per-path audit trail for accuracy measurement lives on each row
  // (resolution_method); the job message carries the totals.
  const pathCounts = new Map<string, number>();
  for (const row of rows) {
    const path = row.resolutionMethod ?? "unresolved";
    pathCounts.set(path, (pathCounts.get(path) ?? 0) + 1);
  }
  const resolutionSummary = [...pathCounts.entries()]
    .map(([path, count]) => `${count} ${path}`)
    .join(", ");
  if (rows.length > 0) await db.insert(clientMedications).values(rows);
  return resolutionSummary;
}

async function insertPharmacies(
  deps: JobDeps,
  job: RxcIntakeJob,
  extraction: RxcExtraction,
): Promise<void> {
  const { db } = deps;
  for (const [index, rawText] of extraction.preferredPharmacies.entries()) {
    await updateJobProgress(db, job.ingestionJobId, {
      message: `Matching pharmacy ${index + 1} of ${extraction.preferredPharmacies.length}`,
    });
    const parsed = parsePharmacyText(rawText);
    const zip = parsed.zip ?? extraction.zip;

    let pharmacyId: string | null = null;
    let matchConfidence: string | null = null;
    if (zip) {
      const candidates = (await loadZipCandidates(db, zip)).map(candidateFromPharmacyRow);
      const best = matchPharmacy(parsed, candidates)[0];
      if (best) {
        pharmacyId = best.candidate.id;
        matchConfidence = best.score.toFixed(3);
      } else if (candidates.length > 0) {
        // Deterministic scorer found nothing → LLM fallback. It only PICKS
        // among the DB candidates (never invents), the confidence is capped
        // below the confident zone, and the link still lands unconfirmed —
        // amber until an agent signs off. A failed call is a non-event.
        const capped = candidates.slice(0, 40);
        const resolution = await deps.extractor
          .resolvePharmacyCandidate(pharmacyResolutionPrompt(rawText, zip, capped))
          .catch(() => null);
        const index = resolution?.matchedIndex;
        if (resolution && index != null && index >= 0 && index < capped.length) {
          pharmacyId = capped[index]!.id;
          matchConfidence = Math.min(resolution.confidence, 0.7).toFixed(3);
        }
      }
    }

    await db.insert(clientPharmacies).values({
      clientId: job.clientId,
      rank: index + 1,
      rawText,
      pharmacyId,
      matchConfidence,
      confirmed: false,
    });
  }
}

async function insertPolicies(
  deps: JobDeps,
  job: RxcIntakeJob,
  extraction: RxcExtraction,
): Promise<void> {
  const { db } = deps;
  const currentIndex = pickCurrentDrugPlanIndex(extraction.inForcePolicies);
  const rows = extraction.inForcePolicies.map((policy, index) => ({
    clientId: job.clientId,
    rawText: policy.rawText,
    carrierName: policy.carrierName,
    policyNumber: policy.policyNumber,
    policyType: policy.policyType,
    isCurrentDrugPlan: index === currentIndex,
  }));
  if (rows.length > 0) await db.insert(inForcePolicies).values(rows);
}
