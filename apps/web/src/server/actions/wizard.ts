"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { and, count, eq, inArray, ne } from "drizzle-orm";
import { z } from "zod";
import {
  carrierPharmacyNetworks,
  formularies,
  formularyEntries,
  getDb,
  plans,
  planTierCosts,
} from "@rxsr/db";
import { uploadObject } from "../storage";
import { err, errorMessage, ok, type ActionResult } from "../action-result";
import { requireRole } from "../auth";
import { writeAudit } from "../audit";
import { enqueueIngestionJob, QUEUE_NAMES } from "../enqueue";

const uuidSchema = z.string().uuid();
const MAX_PDF_BYTES = 100 * 1024 * 1024;

function requirePdf(formData: FormData, field = "pdf"): File {
  const file = formData.get(field) ?? formData.get("file");
  if (!(file instanceof File) || file.size === 0) throw new Error("A PDF file is required");
  const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
  if (!isPdf) throw new Error("Only PDF files are accepted");
  if (file.size > MAX_PDF_BYTES) throw new Error("PDF exceeds the 100 MB limit");
  return file;
}

/** Step 1 — formData: carrierId, planYear, pdf. Label derives from the file. */
export async function startFormularyWizard(
  formData: FormData,
): Promise<ActionResult<{ formularyId: string }>> {
  try {
    const profile = await requireRole("admin", "manager");
    const fields = z
      .object({
        carrierId: uuidSchema,
        planYear: z.coerce.number().int().min(2020).max(2100),
      })
      .parse({ carrierId: formData.get("carrierId"), planYear: formData.get("planYear") });
    const file = requirePdf(formData);
    const label = file.name.replace(/\.pdf$/i, "").trim() || `${fields.planYear} formulary`;

    const db = getDb();
    const [formularyRow] = await db
      .insert(formularies)
      .values({
        carrierId: fields.carrierId,
        planYear: fields.planYear,
        label,
        status: "ingesting",
      })
      .returning({ id: formularies.id });
    if (!formularyRow) return err("Failed to create formulary");

    const storagePath = `formularies/${formularyRow.id}.pdf`;
    await uploadObject(storagePath, new Uint8Array(await file.arrayBuffer()), "application/pdf");
    await db
      .update(formularies)
      .set({ sourceFilePath: storagePath })
      .where(eq(formularies.id, formularyRow.id));

    const { ingestionJobId } = await enqueueIngestionJob({
      kind: "formulary",
      queue: QUEUE_NAMES.formularyIngest,
      targetId: formularyRow.id,
      payload: (jobId) => ({
        ingestionJobId: jobId,
        formularyId: formularyRow.id,
        storagePath,
      }),
    });

    await writeAudit(db, {
      actorId: profile.id,
      action: "formulary.wizard_started",
      entityType: "formulary",
      entityId: formularyRow.id,
      meta: { planYear: fields.planYear, fileName: file.name, ingestionJobId },
    });

    revalidatePath("/", "layout");
    return ok({ formularyId: formularyRow.id });
  } catch (e) {
    return err(errorMessage(e));
  }
}

/** Step 2 → 3 — creates/links one plan per confirmed name. */
export async function approveFormularyPreview(
  formularyId: string,
  planNames: string[],
): Promise<ActionResult<{ planIds: string[] }>> {
  try {
    const profile = await requireRole("admin", "manager");
    uuidSchema.parse(formularyId);
    const names = z
      .array(z.string().trim().min(2).max(120))
      .min(1)
      .max(12)
      .parse(planNames.map((n) => n.trim()).filter((n) => n !== ""));
    const unique = [...new Set(names)];

    const db = getDb();
    const formulary = await db.query.formularies.findFirst({
      where: eq(formularies.id, formularyId),
    });
    if (!formulary) return err("Formulary not found");
    if (formulary.status === "ingesting") return err("Extraction is still running");

    const [unresolved] = await db
      .select({ value: count() })
      .from(formularyEntries)
      .where(
        and(eq(formularyEntries.formularyId, formularyId), eq(formularyEntries.needsReview, true)),
      );
    if ((unresolved?.value ?? 0) > 0) {
      return err(`${unresolved!.value} extraction rows still need review`);
    }

    const planIds: string[] = [];
    await db.transaction(async (tx) => {
      for (const name of unique) {
        const [row] = await tx
          .insert(plans)
          .values({
            carrierId: formulary.carrierId,
            formularyId,
            planYear: formulary.planYear,
            name,
          })
          .onConflictDoUpdate({
            target: [plans.carrierId, plans.name, plans.planYear],
            set: { formularyId },
          })
          .returning({ id: plans.id });
        if (row) planIds.push(row.id);
      }
      await writeAudit(tx, {
        actorId: profile.id,
        action: "formulary.preview_approved",
        entityType: "formulary",
        entityId: formularyId,
        meta: { planNames: unique },
      });
    });

    revalidatePath("/", "layout");
    return ok({ planIds });
  } catch (e) {
    return err(errorMessage(e));
  }
}

/** Step 3 — formData: pdf; planIds: the wizard plans this SBC covers. */
export async function uploadSummaryOfBenefits(
  formularyId: string,
  planIds: string[],
  formData: FormData,
): Promise<ActionResult<{ ingestionJobId: string }>> {
  try {
    const profile = await requireRole("admin", "manager");
    uuidSchema.parse(formularyId);
    const ids = z.array(uuidSchema).min(1).max(12).parse(planIds);
    const file = requirePdf(formData);

    const db = getDb();
    const owned = await db
      .select({ id: plans.id })
      .from(plans)
      .where(and(eq(plans.formularyId, formularyId), inArray(plans.id, ids)));
    if (owned.length !== ids.length) return err("Plan selection does not match this formulary");

    const storagePath = `sob/${formularyId}/${randomUUID()}.pdf`;
    await uploadObject(storagePath, new Uint8Array(await file.arrayBuffer()), "application/pdf");

    const { ingestionJobId } = await enqueueIngestionJob({
      kind: "sob",
      queue: QUEUE_NAMES.sobIngest,
      targetId: formularyId,
      payload: (jobId) => ({ ingestionJobId: jobId, planIds: ids, storagePath }),
    });

    await writeAudit(db, {
      actorId: profile.id,
      action: "plan.sob_uploaded",
      entityType: "formulary",
      entityId: formularyId,
      meta: { planIds: ids, fileName: file.name, ingestionJobId },
    });

    revalidatePath("/", "layout");
    return ok({ ingestionJobId });
  } catch (e) {
    return err(errorMessage(e));
  }
}

/** Step 5 — formData: pdf. The network is the CARRIER's; rows land staged. */
export async function uploadWizardDirectory(
  formularyId: string,
  formData: FormData,
): Promise<ActionResult<{ ingestionJobId: string }>> {
  try {
    const profile = await requireRole("admin", "manager");
    uuidSchema.parse(formularyId);
    const file = requirePdf(formData);

    const db = getDb();
    const formulary = await db.query.formularies.findFirst({
      where: eq(formularies.id, formularyId),
    });
    if (!formulary) return err("Formulary not found");

    const storagePath = `pharmacy-directories/carrier-${formulary.carrierId}.pdf`;
    await uploadObject(storagePath, new Uint8Array(await file.arrayBuffer()), "application/pdf");

    const { ingestionJobId } = await enqueueIngestionJob({
      kind: "pharmacy_directory",
      queue: QUEUE_NAMES.pharmacyDirectory,
      targetId: formularyId,
      payload: (jobId) => ({
        ingestionJobId: jobId,
        carrierId: formulary.carrierId,
        storagePath,
        staged: true,
      }),
    });

    await writeAudit(db, {
      actorId: profile.id,
      action: "plan.wizard_directory_uploaded",
      entityType: "formulary",
      entityId: formularyId,
      meta: { fileName: file.name, ingestionJobId },
    });

    revalidatePath("/", "layout");
    return ok({ ingestionJobId });
  } catch (e) {
    return err(errorMessage(e));
  }
}

/**
 * Step 7 — the single atomic commit: apply staged SoB values to plan columns,
 * flip staged tier-cost and network rows live (staged data replaces any older
 * automated rows), and activate the formulary.
 */
export async function finalizeFormularyWizard(
  formularyId: string,
): Promise<ActionResult<{ formularyId: string }>> {
  try {
    const profile = await requireRole("admin", "manager");
    uuidSchema.parse(formularyId);

    const db = getDb();
    const formulary = await db.query.formularies.findFirst({
      where: eq(formularies.id, formularyId),
    });
    if (!formulary) return err("Formulary not found");
    if (formulary.status === "ingesting") return err("Extraction is still running");

    const [unresolved] = await db
      .select({ value: count() })
      .from(formularyEntries)
      .where(
        and(eq(formularyEntries.formularyId, formularyId), eq(formularyEntries.needsReview, true)),
      );
    if ((unresolved?.value ?? 0) > 0) {
      return err(`${unresolved!.value} extraction rows still need review`);
    }

    const wizardPlans = await db.query.plans.findMany({
      where: eq(plans.formularyId, formularyId),
    });
    if (wizardPlans.length === 0) return err("No plans linked — approve the formulary preview first");
    const planIds = wizardPlans.map((p) => p.id);

    await db.transaction(async (tx) => {
      for (const plan of wizardPlans) {
        const staged = plan.sobStaged;
        if (staged) {
          await tx
            .update(plans)
            .set({
              ...(staged.premiumCents !== undefined && staged.premiumCents !== null
                ? { premiumCents: staged.premiumCents }
                : {}),
              ...(staged.rxDeductibleCents !== undefined && staged.rxDeductibleCents !== null
                ? { rxDeductibleCents: staged.rxDeductibleCents }
                : {}),
              ...(staged.deductibleTiers && staged.deductibleTiers.length > 0
                ? { deductibleTiers: staged.deductibleTiers }
                : {}),
              ...(staged.tierLabels && Object.keys(staged.tierLabels).length > 0
                ? { tierLabels: { ...(plan.tierLabels ?? {}), ...staged.tierLabels } }
                : {}),
              sobStaged: null,
            })
            .where(eq(plans.id, plan.id));
        }

        // Staged tier costs replace the plan's previous unstaged set.
        const [stagedCount] = await tx
          .select({ value: count() })
          .from(planTierCosts)
          .where(and(eq(planTierCosts.planId, plan.id), eq(planTierCosts.staged, true)));
        if ((stagedCount?.value ?? 0) > 0) {
          await tx
            .delete(planTierCosts)
            .where(and(eq(planTierCosts.planId, plan.id), eq(planTierCosts.staged, false)));
          await tx
            .update(planTierCosts)
            .set({ staged: false, verifiedBy: profile.id, verifiedAt: new Date() })
            .where(and(eq(planTierCosts.planId, plan.id), eq(planTierCosts.staged, true)));
        }
      }

      await tx
        .update(carrierPharmacyNetworks)
        .set({ staged: false, verifiedBy: profile.id, verifiedAt: new Date() })
        .where(
          and(
            eq(carrierPharmacyNetworks.carrierId, formulary.carrierId),
            eq(carrierPharmacyNetworks.staged, true),
          ),
        );

      await tx
        .update(formularies)
        .set({ status: "superseded" })
        .where(
          and(
            eq(formularies.carrierId, formulary.carrierId),
            eq(formularies.planYear, formulary.planYear),
            eq(formularies.status, "active"),
            ne(formularies.id, formularyId),
          ),
        );
      await tx
        .update(formularies)
        .set({ status: "active", activatedBy: profile.id, activatedAt: new Date() })
        .where(eq(formularies.id, formularyId));

      await writeAudit(tx, {
        actorId: profile.id,
        action: "formulary.wizard_finalized",
        entityType: "formulary",
        entityId: formularyId,
        meta: { planIds },
      });
    });

    revalidatePath("/", "layout");
    return ok({ formularyId });
  } catch (e) {
    return err(errorMessage(e));
  }
}
