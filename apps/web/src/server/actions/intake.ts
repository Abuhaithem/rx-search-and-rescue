"use server";

import { revalidatePath } from "next/cache";
import { and, eq, notInArray } from "drizzle-orm";
import {
  analyses,
  analysisPharmacies,
  clientMedications,
  clientPharmacies,
  clients,
  getDb,
  inForcePolicies,
} from "@rxsr/db";
import { uploadObject } from "../storage";
import { err, errorMessage, ok, type ActionResult } from "../action-result";
import { requireRole } from "../auth";
import { writeAudit } from "../audit";
import { enqueueIngestionJob, QUEUE_NAMES } from "../enqueue";
import {
  confirmIntakeSchema,
  manualClientSchema,
  type ConfirmIntakeInput,
  type ManualClientInput,
} from "../schemas";

const MAX_PDF_BYTES = 25 * 1024 * 1024;

function requirePdf(formData: FormData, field = "file"): File {
  const file = formData.get(field);
  if (!(file instanceof File) || file.size === 0) throw new Error("A PDF file is required");
  const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
  if (!isPdf) throw new Error("Only PDF files are accepted");
  if (file.size > MAX_PDF_BYTES) throw new Error("PDF exceeds the 25 MB limit");
  return file;
}

/** formData: file (PDF, required), clientName (optional label until extraction lands). */
export async function uploadRxc(formData: FormData): Promise<ActionResult<{ clientId: string }>> {
  try {
    const profile = await requireRole();
    const file = requirePdf(formData);
    const clientNameRaw = formData.get("clientName");
    const clientName =
      typeof clientNameRaw === "string" && clientNameRaw.trim().length > 0
        ? clientNameRaw.trim()
        : "Rx Collect (processing…)";

    const db = getDb();
    const [clientRow] = await db
      .insert(clients)
      .values({ fullName: clientName, createdBy: profile.id })
      .returning({ id: clients.id });
    if (!clientRow) return err("Failed to create client");

    const storagePath = `rxc/${clientRow.id}.pdf`;
    await uploadObject(storagePath, new Uint8Array(await file.arrayBuffer()), "application/pdf");

    await db.update(clients).set({ sourceRxcPath: storagePath }).where(eq(clients.id, clientRow.id));

    const { ingestionJobId } = await enqueueIngestionJob({
      kind: "rxc",
      queue: QUEUE_NAMES.rxcIntake,
      targetId: clientRow.id,
      payload: (jobId) => ({ ingestionJobId: jobId, clientId: clientRow.id, storagePath }),
    });

    await writeAudit(db, {
      actorId: profile.id,
      action: "client.rxc_uploaded",
      entityType: "client",
      entityId: clientRow.id,
      meta: { storagePath, ingestionJobId, fileName: file.name },
    });

    revalidatePath("/", "layout");
    return ok({ clientId: clientRow.id });
  } catch (e) {
    return err(errorMessage(e));
  }
}

/** Re-enqueue extraction for an already-uploaded RxC PDF (after a failed job). */
export async function retryRxcExtraction(
  clientId: string,
): Promise<ActionResult<{ clientId: string }>> {
  try {
    const profile = await requireRole();
    const db = getDb();
    const client = await db.query.clients.findFirst({ where: eq(clients.id, clientId) });
    if (!client) return err("Client not found");
    if (!client.sourceRxcPath) return err("No uploaded RxC PDF to re-process");
    const storagePath = client.sourceRxcPath;

    const { ingestionJobId } = await enqueueIngestionJob({
      kind: "rxc",
      queue: QUEUE_NAMES.rxcIntake,
      targetId: clientId,
      payload: (jobId) => ({ ingestionJobId: jobId, clientId, storagePath }),
    });

    await writeAudit(db, {
      actorId: profile.id,
      action: "client.rxc_retry",
      entityType: "client",
      entityId: clientId,
      meta: { storagePath, ingestionJobId },
    });

    revalidatePath(`/intake/${clientId}`);
    return ok({ clientId });
  } catch (e) {
    return err(errorMessage(e));
  }
}

export async function confirmIntake(
  clientId: string,
  payload: ConfirmIntakeInput,
): Promise<ActionResult<{ analysisId: string }>> {
  try {
    const profile = await requireRole();
    const input = confirmIntakeSchema.parse(payload);
    const db = getDb();

    const existing = await db.query.clients.findFirst({ where: eq(clients.id, clientId) });
    if (!existing) return err("Client not found");

    const analysisId = await db.transaction(async (tx) => {
      await tx
        .update(clients)
        .set({ ...input.client, updatedAt: new Date() })
        .where(eq(clients.id, clientId));

      // Medications: update kept rows, insert new ones, drop the rest.
      const keptMedicationIds: string[] = [];
      for (const med of input.medications) {
        const values = {
          name: med.name,
          dosageText: med.dosageText ?? null,
          rxcui: med.rxcui ?? null,
          strength: med.strength ?? null,
          form: med.form ?? null,
          quantity: med.quantity ?? null,
          daysSupply: med.daysSupply ?? null,
          genericOk: med.genericOk,
          prn: med.prn,
          position: med.position,
          confirmed: true,
        };
        if (med.id) {
          await tx.update(clientMedications).set(values).where(eq(clientMedications.id, med.id));
          keptMedicationIds.push(med.id);
        } else {
          const [row] = await tx
            .insert(clientMedications)
            .values({
              ...values,
              clientId,
              rawText: med.rawText ?? med.dosageText ?? med.name,
              source: "manual",
            })
            .returning({ id: clientMedications.id });
          if (row) keptMedicationIds.push(row.id);
        }
      }
      await tx
        .delete(clientMedications)
        .where(
          keptMedicationIds.length > 0
            ? and(
                eq(clientMedications.clientId, clientId),
                notInArray(clientMedications.id, keptMedicationIds),
              )
            : eq(clientMedications.clientId, clientId),
        );

      // Pharmacies.
      const keptPharmacyIds: string[] = [];
      for (const pharmacy of input.pharmacies) {
        const values = {
          rank: pharmacy.rank,
          rawText: pharmacy.rawText,
          pharmacyId: pharmacy.pharmacyId ?? null,
          confirmed: true,
        };
        if (pharmacy.id) {
          await tx.update(clientPharmacies).set(values).where(eq(clientPharmacies.id, pharmacy.id));
          keptPharmacyIds.push(pharmacy.id);
        } else {
          const [row] = await tx
            .insert(clientPharmacies)
            .values({ ...values, clientId })
            .returning({ id: clientPharmacies.id });
          if (row) keptPharmacyIds.push(row.id);
        }
      }
      await tx
        .delete(clientPharmacies)
        .where(
          keptPharmacyIds.length > 0
            ? and(
                eq(clientPharmacies.clientId, clientId),
                notInArray(clientPharmacies.id, keptPharmacyIds),
              )
            : eq(clientPharmacies.clientId, clientId),
        );

      // In-force policies.
      const keptPolicyIds: string[] = [];
      for (const policy of input.policies) {
        const values = {
          rawText: policy.rawText,
          carrierName: policy.carrierName ?? null,
          policyNumber: policy.policyNumber ?? null,
          policyType: policy.policyType,
          isCurrentDrugPlan: policy.isCurrentDrugPlan,
          matchedPlanId: policy.matchedPlanId ?? null,
        };
        if (policy.id) {
          await tx.update(inForcePolicies).set(values).where(eq(inForcePolicies.id, policy.id));
          keptPolicyIds.push(policy.id);
        } else {
          const [row] = await tx
            .insert(inForcePolicies)
            .values({ ...values, clientId })
            .returning({ id: inForcePolicies.id });
          if (row) keptPolicyIds.push(row.id);
        }
      }
      await tx
        .delete(inForcePolicies)
        .where(
          keptPolicyIds.length > 0
            ? and(
                eq(inForcePolicies.clientId, clientId),
                notInArray(inForcePolicies.id, keptPolicyIds),
              )
            : eq(inForcePolicies.clientId, clientId),
        );

      const [analysisRow] = await tx
        .insert(analyses)
        .values({
          clientId,
          planYear: input.planYear,
          status: "new",
          assignedTo: profile.id,
          createdBy: profile.id,
        })
        .returning({ id: analyses.id });
      if (!analysisRow) throw new Error("Failed to create analysis");

      // Cost-matrix rows: the client's matched pharmacies, deduped, ordered by rank.
      const pricedPharmacies = [
        ...new Map(
          input.pharmacies
            .slice()
            .sort((a, b) => (a.rank ?? 1) - (b.rank ?? 1))
            .filter((p): p is typeof p & { pharmacyId: string } => Boolean(p.pharmacyId))
            .map((p) => [p.pharmacyId, p]),
        ).values(),
      ];
      if (pricedPharmacies.length > 0) {
        await tx.insert(analysisPharmacies).values(
          pricedPharmacies.map((p, position) => ({
            analysisId: analysisRow.id,
            pharmacyId: p.pharmacyId,
            position,
          })),
        );
      }

      await writeAudit(tx, {
        actorId: profile.id,
        action: "client.intake_confirmed",
        entityType: "client",
        entityId: clientId,
        meta: {
          medicationCount: input.medications.length,
          pharmacyCount: input.pharmacies.length,
          policyCount: input.policies.length,
        },
      });
      await writeAudit(tx, {
        actorId: profile.id,
        action: "analysis.created",
        entityType: "analysis",
        entityId: analysisRow.id,
        meta: { clientId, planYear: input.planYear },
      });

      return analysisRow.id;
    });

    revalidatePath("/", "layout");
    return ok({ analysisId });
  } catch (e) {
    return err(errorMessage(e));
  }
}

export async function createManualClient(
  payload: ManualClientInput,
): Promise<ActionResult<{ clientId: string }>> {
  try {
    const profile = await requireRole();
    const input = manualClientSchema.parse(payload);
    const db = getDb();

    const clientId = await db.transaction(async (tx) => {
      const [clientRow] = await tx
        .insert(clients)
        .values({ ...input.client, createdBy: profile.id })
        .returning({ id: clients.id });
      if (!clientRow) throw new Error("Failed to create client");

      if (input.medications.length > 0) {
        await tx.insert(clientMedications).values(
          input.medications.map((med) => ({
            clientId: clientRow.id,
            rawText: med.rawText ?? med.dosageText ?? med.name,
            name: med.name,
            dosageText: med.dosageText ?? null,
            rxcui: med.rxcui ?? null,
            strength: med.strength ?? null,
            form: med.form ?? null,
            quantity: med.quantity ?? null,
            daysSupply: med.daysSupply ?? null,
            genericOk: med.genericOk,
            prn: med.prn,
            position: med.position,
            source: "manual" as const,
            confirmed: true,
          })),
        );
      }

      if (input.pharmacies.length > 0) {
        await tx.insert(clientPharmacies).values(
          input.pharmacies.map((pharmacy) => ({
            clientId: clientRow.id,
            rank: pharmacy.rank,
            rawText: pharmacy.rawText,
            pharmacyId: pharmacy.pharmacyId ?? null,
            confirmed: true,
          })),
        );
      }

      if (input.policies.length > 0) {
        await tx.insert(inForcePolicies).values(
          input.policies.map((policy) => ({
            clientId: clientRow.id,
            rawText: policy.rawText,
            carrierName: policy.carrierName ?? null,
            policyNumber: policy.policyNumber ?? null,
            policyType: policy.policyType,
            isCurrentDrugPlan: policy.isCurrentDrugPlan,
            matchedPlanId: policy.matchedPlanId ?? null,
          })),
        );
      }

      await writeAudit(tx, {
        actorId: profile.id,
        action: "client.created_manual",
        entityType: "client",
        entityId: clientRow.id,
        meta: { medicationCount: input.medications.length },
      });

      return clientRow.id;
    });

    revalidatePath("/", "layout");
    return ok({ clientId });
  } catch (e) {
    return err(errorMessage(e));
  }
}
