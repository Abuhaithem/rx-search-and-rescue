/**
 * RxC intake: download the uploaded RxC PDF, Claude-extract, RxNorm-normalize
 * medications, resolve preferred pharmacies, classify in-force policies, and
 * land everything unconfirmed (agents flip `confirmed` on the review screen).
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
import {
  ensurePharmacyId,
  loadZipCandidates,
  mergeCandidates,
} from "../lib/pharmacies";
import { createJobDeps, type JobDeps } from "./deps";

/** Single best drug plan: pdp beats ma_pd; med_supp/other never qualify. */
export function pickCurrentDrugPlanIndex(policies: ExtractedPolicy[]): number {
  const pdp = policies.findIndex((p) => p.policyType === "pdp");
  if (pdp !== -1) return pdp;
  return policies.findIndex((p) => p.policyType === "ma_pd");
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
    const pdfBase64 = Buffer.from(pdfBytes).toString("base64");

    await updateJobProgress(db, job.ingestionJobId, { message: "Extracting with Claude" });
    const extraction = await deps.extractor.extractRxc(pdfBase64);

    await updateJobProgress(db, job.ingestionJobId, { message: "Saving client details" });
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

    await insertMedications(deps, job, extraction);
    await insertPharmacies(deps, job, extraction);
    await insertPolicies(deps, job, extraction);

    await markJobDone(db, job.ingestionJobId, {
      message: `Extracted ${extraction.medications.length} medications, ${extraction.preferredPharmacies.length} pharmacies, ${extraction.inForcePolicies.length} policies`,
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
): Promise<void> {
  const { db } = deps;
  await updateJobProgress(db, job.ingestionJobId, {
    message: `Normalizing ${extraction.medications.length} medications via RxNorm`,
  });

  const rows: (typeof clientMedications.$inferInsert)[] = [];
  for (const [index, medication] of extraction.medications.entries()) {
    // RxNorm is a free best-effort service: a lookup failure downgrades to a
    // null rxcui (agent resolves later) instead of failing the whole intake.
    const rxcui = await deps.rxnorm
      .findRxcuiByString(medication.dosageText ?? medication.name)
      .catch(() => null);
    const dosage = parseDosageText(medication.dosageText);
    rows.push({
      clientId: job.clientId,
      rawText: medication.rawText,
      name: medication.name,
      dosageText: medication.dosageText,
      rxcui,
      strength: dosage.strength,
      form: dosage.form,
      quantity: medication.quantity,
      daysSupply: medication.daysSupply,
      genericOk: medication.genericOk ?? true,
      prn: medication.prn,
      source: medication.source,
      confidence: medication.confidence.toFixed(3),
      confirmed: false,
      position: index,
    });
  }
  if (rows.length > 0) await db.insert(clientMedications).values(rows);
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
      const dbRows = await loadZipCandidates(db, zip);
      const nppesCandidates = await deps.nppes
        .searchPharmacies({ zip })
        .catch(() => []);
      const pool = mergeCandidates(dbRows, nppesCandidates);
      const best = matchPharmacy(parsed, pool.candidates)[0];
      if (best) {
        pharmacyId = await ensurePharmacyId(db, best.candidate, pool);
        matchConfidence = best.score.toFixed(3);
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
