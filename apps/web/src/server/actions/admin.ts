"use server";

import { revalidatePath } from "next/cache";
import { and, count, eq, inArray, ne } from "drizzle-orm";
import { z } from "zod";
import {
  analysisPlans,
  analysisResults,
  carrierPharmacyNetworks,
  carriers,
  formularies,
  formularyEntries,
  getDb,
  inForcePolicies,
  planPharmacyNetworks,
  planServiceAreas,
  planTierCosts,
  plans,
} from "@rxsr/db";
import type { NetworkStatus } from "@rxsr/core";
import { deleteObject, uploadObject } from "../storage";
import { err, errorMessage, ok, type ActionResult } from "../action-result";
import { requireRole } from "../auth";
import { writeAudit } from "../audit";
import { enqueueIngestionJob, QUEUE_NAMES } from "../enqueue";
import {
  networkStatusSchema,
  planUpsertSchema,
  reviewDecisionSchema,
  serviceAreaSchema,
  tierCostRowSchema,
  type PlanUpsertInput,
  type ReviewDecision,
  type ServiceAreaInput,
  type TierCostRowInput,
} from "../schemas";

const uuidSchema = z.string().uuid();
const MAX_PDF_BYTES = 100 * 1024 * 1024; // formularies run hundreds of pages

function requirePdf(formData: FormData, field = "pdf"): File {
  const file = formData.get(field) ?? formData.get("file");
  if (!(file instanceof File) || file.size === 0) throw new Error("A PDF file is required");
  const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
  if (!isPdf) throw new Error("Only PDF files are accepted");
  if (file.size > MAX_PDF_BYTES) throw new Error("PDF exceeds the 100 MB limit");
  return file;
}

const slugify = (name: string): string =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const carrierNameSchema = z.string().trim().min(2).max(80);

export async function createCarrier(
  name: string,
): Promise<ActionResult<{ carrierId: string }>> {
  try {
    const profile = await requireRole("admin", "manager");
    const carrierName = carrierNameSchema.parse(name);
    const slug = slugify(carrierName);
    if (!slug) return err("Carrier name needs at least one letter or number");

    const db = getDb();
    const existing = await db.select().from(carriers).where(eq(carriers.slug, slug));
    if (existing[0]) return err(`"${existing[0].name}" already exists`);

    const [inserted] = await db
      .insert(carriers)
      .values({ name: carrierName, slug })
      .returning({ id: carriers.id });
    if (!inserted) return err("Failed to create carrier");

    await writeAudit(db, {
      actorId: profile.id,
      action: "carrier.created",
      entityType: "carrier",
      entityId: inserted.id,
      meta: { name: carrierName },
    });

    revalidatePath("/", "layout");
    return ok({ carrierId: inserted.id });
  } catch (e) {
    return err(errorMessage(e));
  }
}

export async function renameCarrier(
  carrierId: string,
  name: string,
): Promise<ActionResult<{ carrierId: string }>> {
  try {
    const profile = await requireRole("admin", "manager");
    uuidSchema.parse(carrierId);
    const carrierName = carrierNameSchema.parse(name);
    const slug = slugify(carrierName);
    if (!slug) return err("Carrier name needs at least one letter or number");

    const db = getDb();
    const clash = await db.select().from(carriers).where(eq(carriers.slug, slug));
    if (clash[0] && clash[0].id !== carrierId) {
      return err(`"${clash[0].name}" already uses that name`);
    }

    const [updated] = await db
      .update(carriers)
      .set({ name: carrierName, slug })
      .where(eq(carriers.id, carrierId))
      .returning({ id: carriers.id });
    if (!updated) return err("Carrier not found");

    await writeAudit(db, {
      actorId: profile.id,
      action: "carrier.renamed",
      entityType: "carrier",
      entityId: carrierId,
      meta: { name: carrierName },
    });

    revalidatePath("/", "layout");
    return ok({ carrierId });
  } catch (e) {
    return err(errorMessage(e));
  }
}

/** Remove an empty carrier (duplicates, typos). Refuses if anything hangs off it. */
export async function deleteCarrier(
  carrierId: string,
): Promise<ActionResult<{ carrierId: string }>> {
  try {
    const profile = await requireRole("admin", "manager");
    uuidSchema.parse(carrierId);
    const db = getDb();

    const [carrier] = await db.select().from(carriers).where(eq(carriers.id, carrierId));
    if (!carrier) return err("Carrier not found");
    const [planCount] = await db
      .select({ value: count() })
      .from(plans)
      .where(eq(plans.carrierId, carrierId));
    const [formularyCount] = await db
      .select({ value: count() })
      .from(formularies)
      .where(eq(formularies.carrierId, carrierId));
    if ((planCount?.value ?? 0) > 0 || (formularyCount?.value ?? 0) > 0) {
      return err("This carrier has plans or uploads — move or delete those first");
    }

    await db.delete(carriers).where(eq(carriers.id, carrierId));
    await writeAudit(db, {
      actorId: profile.id,
      action: "carrier.deleted",
      entityType: "carrier",
      entityId: carrierId,
      meta: { name: carrier.name },
    });

    revalidatePath("/", "layout");
    return ok({ carrierId });
  } catch (e) {
    return err(errorMessage(e));
  }
}

type Tx = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];

async function resolveCarrierId(
  executor: Tx | ReturnType<typeof getDb>,
  carrierName: string,
): Promise<string> {
  const slug = slugify(carrierName);
  const existing = await executor.select().from(carriers).where(eq(carriers.slug, slug));
  if (existing[0]) return existing[0].id;
  const [inserted] = await executor
    .insert(carriers)
    .values({ name: carrierName, slug })
    .returning({ id: carriers.id });
  if (!inserted) throw new Error("Failed to create carrier");
  return inserted.id;
}

/** formData: carrier (name), planYear, label, pdf. */
export async function uploadFormulary(
  formData: FormData,
): Promise<ActionResult<{ formularyId: string }>> {
  try {
    const profile = await requireRole("admin", "manager");
    const fields = z
      .object({
        carrier: z.string().min(1),
        planYear: z.coerce.number().int().min(2020).max(2100),
        label: z.string().min(1),
      })
      .parse({
        carrier: formData.get("carrier"),
        planYear: formData.get("planYear"),
        label: formData.get("label"),
      });
    const file = requirePdf(formData);

    const db = getDb();
    const carrierId = await resolveCarrierId(db, fields.carrier);
    const [formularyRow] = await db
      .insert(formularies)
      .values({
        carrierId,
        planYear: fields.planYear,
        label: fields.label,
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
      action: "formulary.uploaded",
      entityType: "formulary",
      entityId: formularyRow.id,
      meta: { carrier: fields.carrier, planYear: fields.planYear, ingestionJobId },
    });

    revalidatePath("/", "layout");
    return ok({ formularyId: formularyRow.id });
  } catch (e) {
    return err(errorMessage(e));
  }
}

const entryPatchSchema = z.object({
  rawDrugName: z.string().trim().min(1).max(300).optional(),
  tier: z.number().int().min(1).max(6).optional(),
  rawRequirementsText: z.string().trim().max(500).nullable().optional(),
});
export type FormularyEntryPatch = z.infer<typeof entryPatchSchema>;

/** Direct edit from the plan workspace; clears the review flag. */
export async function updateFormularyEntry(
  entryId: string,
  patch: FormularyEntryPatch,
): Promise<ActionResult<{ entryId: string }>> {
  try {
    const profile = await requireRole("admin", "manager");
    uuidSchema.parse(entryId);
    const input = entryPatchSchema.parse(patch);
    if (Object.keys(input).length === 0) return err("Nothing to change");

    const db = getDb();
    const [updated] = await db
      .update(formularyEntries)
      .set({
        ...(input.rawDrugName !== undefined
          ? { rawDrugName: input.rawDrugName, normalizedName: input.rawDrugName.toLowerCase() }
          : {}),
        ...(input.tier !== undefined ? { tier: input.tier } : {}),
        ...(input.rawRequirementsText !== undefined
          ? { rawRequirementsText: input.rawRequirementsText }
          : {}),
        needsReview: false,
        reviewedBy: profile.id,
      })
      .where(eq(formularyEntries.id, entryId))
      .returning({ id: formularyEntries.id, formularyId: formularyEntries.formularyId });
    if (!updated) return err("Entry not found");

    await writeAudit(db, {
      actorId: profile.id,
      action: "formulary.entry_edited",
      entityType: "formulary_entry",
      entityId: entryId,
      meta: { formularyId: updated.formularyId, patch: input },
    });

    revalidatePath("/", "layout");
    return ok({ entryId });
  } catch (e) {
    return err(errorMessage(e));
  }
}

export async function deleteFormularyEntry(
  entryId: string,
): Promise<ActionResult<{ entryId: string }>> {
  try {
    const profile = await requireRole("admin", "manager");
    uuidSchema.parse(entryId);

    const db = getDb();
    const [removed] = await db
      .delete(formularyEntries)
      .where(eq(formularyEntries.id, entryId))
      .returning({ id: formularyEntries.id, formularyId: formularyEntries.formularyId });
    if (!removed) return err("Entry not found");

    await writeAudit(db, {
      actorId: profile.id,
      action: "formulary.entry_deleted",
      entityType: "formulary_entry",
      entityId: entryId,
      meta: { formularyId: removed.formularyId },
    });

    revalidatePath("/", "layout");
    return ok({ entryId });
  } catch (e) {
    return err(errorMessage(e));
  }
}

const entryAddSchema = z.object({
  rawDrugName: z.string().trim().min(1).max(300),
  tier: z.number().int().min(1).max(6),
  rawRequirementsText: z.string().trim().max(500).nullable(),
});

/** Manual drug row (e.g. a drug the extractor missed). */
export async function addFormularyEntry(
  formularyId: string,
  row: z.infer<typeof entryAddSchema>,
): Promise<ActionResult<{ entryId: string }>> {
  try {
    const profile = await requireRole("admin", "manager");
    uuidSchema.parse(formularyId);
    const input = entryAddSchema.parse(row);

    const db = getDb();
    const formulary = await db.query.formularies.findFirst({
      where: eq(formularies.id, formularyId),
    });
    if (!formulary) return err("Formulary not found");

    const [inserted] = await db
      .insert(formularyEntries)
      .values({
        formularyId,
        rawDrugName: input.rawDrugName,
        normalizedName: input.rawDrugName.toLowerCase(),
        tier: input.tier,
        rawRequirementsText: input.rawRequirementsText,
        sourcePage: 0, // manual rows have no source page
        needsReview: false,
        reviewedBy: profile.id,
      })
      .returning({ id: formularyEntries.id });
    if (!inserted) return err("Failed to add entry");

    await writeAudit(db, {
      actorId: profile.id,
      action: "formulary.entry_added",
      entityType: "formulary_entry",
      entityId: inserted.id,
      meta: { formularyId, rawDrugName: input.rawDrugName, tier: input.tier },
    });

    revalidatePath("/", "layout");
    return ok({ entryId: inserted.id });
  } catch (e) {
    return err(errorMessage(e));
  }
}

/**
 * Delete a drug plan wholesale: the formulary (entries and legends cascade),
 * its linked plans (tier costs, service areas, network rows cascade), and the
 * stored PDFs (formulary source + Summaries of Benefits) in S3. Refused only
 * when a linked plan is cited by a client analysis — analyses must be deleted
 * first so results never point at a missing plan.
 */
export async function deleteFormulary(
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

    const linkedPlans = await db
      .select({ id: plans.id, sobPath: plans.sobPath })
      .from(plans)
      .where(eq(plans.formularyId, formularyId));
    const planIds = linkedPlans.map((p) => p.id);

    if (planIds.length > 0) {
      const [inAnalyses] = await db
        .select({ value: count() })
        .from(analysisPlans)
        .where(inArray(analysisPlans.planId, planIds));
      const [inResults] = await db
        .select({ value: count() })
        .from(analysisResults)
        .where(inArray(analysisResults.planId, planIds));
      if ((inAnalyses?.value ?? 0) > 0 || (inResults?.value ?? 0) > 0) {
        return err(
          "Plans from this upload are used in client analyses — delete those analyses first",
        );
      }
    }

    await db.transaction(async (tx) => {
      if (planIds.length > 0) {
        // In-force policy matches are soft links; the policy record stays.
        await tx
          .update(inForcePolicies)
          .set({ matchedPlanId: null })
          .where(inArray(inForcePolicies.matchedPlanId, planIds));
        await tx.delete(plans).where(inArray(plans.id, planIds));
      }
      await tx.delete(formularies).where(eq(formularies.id, formularyId));
      await writeAudit(tx, {
        actorId: profile.id,
        action: "formulary.deleted",
        entityType: "formulary",
        entityId: formularyId,
        meta: {
          label: formulary.label,
          status: formulary.status,
          planCount: planIds.length,
        },
      });
    });

    // After the commit, best-effort S3 cleanup (deleteObject never throws).
    const objectKeys = new Set(
      [formulary.sourceFilePath, ...linkedPlans.map((p) => p.sobPath)].filter(
        (key): key is string => key !== null && key !== undefined,
      ),
    );
    await Promise.all([...objectKeys].map((key) => deleteObject(key)));

    revalidatePath("/", "layout");
    return ok({ formularyId });
  } catch (e) {
    return err(errorMessage(e));
  }
}

/**
 * Delete one plan: its tier costs, service areas, and network rows cascade;
 * its Summary of Benefits leaves S3 unless another plan shares the file.
 * Refused while the plan is cited by a client analysis.
 */
export async function deletePlan(
  planId: string,
): Promise<ActionResult<{ planId: string; planYear: number }>> {
  try {
    const profile = await requireRole("admin", "manager");
    uuidSchema.parse(planId);

    const db = getDb();
    const plan = await db.query.plans.findFirst({ where: eq(plans.id, planId) });
    if (!plan) return err("Plan not found");

    const [inAnalyses] = await db
      .select({ value: count() })
      .from(analysisPlans)
      .where(eq(analysisPlans.planId, planId));
    const [inResults] = await db
      .select({ value: count() })
      .from(analysisResults)
      .where(eq(analysisResults.planId, planId));
    if ((inAnalyses?.value ?? 0) > 0 || (inResults?.value ?? 0) > 0) {
      return err("This plan is used in client analyses — delete those analyses first");
    }

    await db.transaction(async (tx) => {
      // In-force policy matches are soft links; the policy record stays.
      await tx
        .update(inForcePolicies)
        .set({ matchedPlanId: null })
        .where(eq(inForcePolicies.matchedPlanId, planId));
      await tx.delete(plans).where(eq(plans.id, planId));
      await writeAudit(tx, {
        actorId: profile.id,
        action: "plan.deleted",
        entityType: "plan",
        entityId: planId,
        meta: { name: plan.name, planYear: plan.planYear },
      });
    });

    // One SOB PDF can cover several sibling plans — only delete when orphaned.
    if (plan.sobPath) {
      const [sharing] = await db
        .select({ value: count() })
        .from(plans)
        .where(eq(plans.sobPath, plan.sobPath));
      if ((sharing?.value ?? 0) === 0) await deleteObject(plan.sobPath);
    }

    revalidatePath("/", "layout");
    return ok({ planId, planYear: plan.planYear });
  } catch (e) {
    return err(errorMessage(e));
  }
}

const bulkReviewSchema = z.object({
  action: z.enum(["accept", "remove"]),
  /** Omitted = every row still flagged for review on this formulary. */
  entryIds: z.array(uuidSchema).min(1).max(5000).optional(),
});
export type BulkReviewInput = z.infer<typeof bulkReviewSchema>;

export async function bulkResolveReviewRows(
  formularyId: string,
  decision: BulkReviewInput,
): Promise<ActionResult<{ count: number }>> {
  try {
    const profile = await requireRole("admin", "manager");
    uuidSchema.parse(formularyId);
    const input = bulkReviewSchema.parse(decision);

    const db = getDb();
    const scope = and(
      eq(formularyEntries.formularyId, formularyId),
      eq(formularyEntries.needsReview, true),
      ...(input.entryIds ? [inArray(formularyEntries.id, input.entryIds)] : []),
    );

    const resolvedCount = await db.transaction(async (tx) => {
      const rows =
        input.action === "remove"
          ? await tx.delete(formularyEntries).where(scope).returning({ id: formularyEntries.id })
          : await tx
              .update(formularyEntries)
              .set({ needsReview: false, reviewedBy: profile.id })
              .where(scope)
              .returning({ id: formularyEntries.id });
      await writeAudit(tx, {
        actorId: profile.id,
        action: "formulary.review_bulk_resolved",
        entityType: "formulary",
        entityId: formularyId,
        meta: { decision: input.action, count: rows.length },
      });
      return rows.length;
    });

    revalidatePath("/", "layout");
    return ok({ count: resolvedCount });
  } catch (e) {
    return err(errorMessage(e));
  }
}

export async function resolveReviewRow(
  entryId: string,
  decision: ReviewDecision,
): Promise<ActionResult<{ entryId: string }>> {
  try {
    const profile = await requireRole("admin", "manager");
    uuidSchema.parse(entryId);
    const input = reviewDecisionSchema.parse(decision);

    const db = getDb();
    const entry = await db.query.formularyEntries.findFirst({
      where: eq(formularyEntries.id, entryId),
    });
    if (!entry) return err("Formulary entry not found");

    await db.transaction(async (tx) => {
      if (input.action === "remove") {
        await tx.delete(formularyEntries).where(eq(formularyEntries.id, entryId));
      } else {
        const edits =
          input.action === "edit"
            ? {
                ...(input.rawDrugName !== undefined ? { rawDrugName: input.rawDrugName } : {}),
                ...(input.normalizedName !== undefined
                  ? { normalizedName: input.normalizedName ?? null }
                  : {}),
                ...(input.tier !== undefined ? { tier: input.tier } : {}),
                ...(input.isBrand !== undefined ? { isBrand: input.isBrand } : {}),
                ...(input.pa !== undefined ? { pa: input.pa } : {}),
                ...(input.st !== undefined ? { st: input.st } : {}),
                ...(input.qlQuantity !== undefined ? { qlQuantity: input.qlQuantity ?? null } : {}),
                ...(input.qlDays !== undefined ? { qlDays: input.qlDays ?? null } : {}),
                ...(input.extraFlags !== undefined ? { extraFlags: input.extraFlags } : {}),
              }
            : {};
        await tx
          .update(formularyEntries)
          .set({ ...edits, needsReview: false, reviewedBy: profile.id })
          .where(eq(formularyEntries.id, entryId));
      }
      await writeAudit(tx, {
        actorId: profile.id,
        action: "formulary.review_resolved",
        entityType: "formulary_entry",
        entityId: entryId,
        meta: { formularyId: entry.formularyId, decision: input.action },
      });
    });

    revalidatePath("/", "layout");
    return ok({ entryId });
  } catch (e) {
    return err(errorMessage(e));
  }
}

export async function activateFormulary(
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

    const [unresolved] = await db
      .select({ value: count() })
      .from(formularyEntries)
      .where(
        and(eq(formularyEntries.formularyId, formularyId), eq(formularyEntries.needsReview, true)),
      );
    if ((unresolved?.value ?? 0) > 0) {
      return err(`${unresolved!.value} extraction rows still need review`);
    }

    await db.transaction(async (tx) => {
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
        action: "formulary.activated",
        entityType: "formulary",
        entityId: formularyId,
      });
    });

    revalidatePath("/", "layout");
    return ok({ formularyId });
  } catch (e) {
    return err(errorMessage(e));
  }
}

export async function upsertPlan(
  payload: PlanUpsertInput,
): Promise<ActionResult<{ planId: string }>> {
  try {
    const profile = await requireRole("admin", "manager");
    const input = planUpsertSchema.parse(payload);

    const db = getDb();
    const planId = await db.transaction(async (tx) => {
      const carrierId = input.carrierId ?? (await resolveCarrierId(tx, input.carrierName!));
      // Blank label entries mean "use the default" — drop them on save.
      const tierLabels =
        input.tierLabels === undefined
          ? undefined
          : Object.fromEntries(
              Object.entries(input.tierLabels)
                .map(([tier, label]) => [tier, label?.trim() ?? ""])
                .filter(([, label]) => label !== ""),
            );
      const values = {
        carrierId,
        formularyId: input.formularyId ?? null,
        planYear: input.planYear,
        name: input.name,
        contractPlanId: input.contractPlanId ?? null,
        premiumCents: input.premiumCents ?? null,
        rxDeductibleCents: input.rxDeductibleCents ?? null,
        deductibleTiers: input.deductibleTiers ?? [],
        curated: input.curated ?? true,
        ...(input.lisCostSharing !== undefined ? { lisCostSharing: input.lisCostSharing } : {}),
        ...(tierLabels !== undefined ? { tierLabels } : {}),
      };

      let id: string;
      if (input.id) {
        const [updated] = await tx
          .update(plans)
          .set(values)
          .where(eq(plans.id, input.id))
          .returning({ id: plans.id });
        if (!updated) throw new Error("Plan not found");
        id = updated.id;
      } else {
        const [row] = await tx
          .insert(plans)
          .values(values)
          .onConflictDoUpdate({
            target: [plans.carrierId, plans.name, plans.planYear],
            set: values,
          })
          .returning({ id: plans.id });
        if (!row) throw new Error("Failed to upsert plan");
        id = row.id;
      }

      await writeAudit(tx, {
        actorId: profile.id,
        action: "plan.upserted",
        entityType: "plan",
        entityId: id,
        meta: { name: input.name, planYear: input.planYear },
      });
      return id;
    });

    revalidatePath("/", "layout");
    return ok({ planId });
  } catch (e) {
    return err(errorMessage(e));
  }
}

export async function upsertTierCosts(
  planId: string,
  rows: TierCostRowInput[],
): Promise<ActionResult<{ planId: string; rowCount: number }>> {
  try {
    const profile = await requireRole("admin", "manager");
    uuidSchema.parse(planId);
    const input = z.array(tierCostRowSchema).min(1).parse(rows);

    const db = getDb();
    const plan = await db.query.plans.findFirst({ where: eq(plans.id, planId) });
    if (!plan) return err("Plan not found");

    await db.transaction(async (tx) => {
      await tx.delete(planTierCosts).where(eq(planTierCosts.planId, planId));
      await tx.insert(planTierCosts).values(
        input.map((row) => ({
          planId,
          channel: row.channel,
          tier: row.tier,
          daysSupply: row.daysSupply,
          copayCents: row.copayCents,
          coinsurancePct: row.coinsurancePct == null ? null : String(row.coinsurancePct),
          sourceNote: row.sourceNote ?? null,
          verifiedBy: profile.id,
          verifiedAt: new Date(),
        })),
      );
      await writeAudit(tx, {
        actorId: profile.id,
        action: "plan.tier_costs_upserted",
        entityType: "plan",
        entityId: planId,
        meta: { rowCount: input.length },
      });
    });

    revalidatePath("/", "layout");
    return ok({ planId, rowCount: input.length });
  } catch (e) {
    return err(errorMessage(e));
  }
}

export async function setServiceAreas(
  planId: string,
  areas: ServiceAreaInput[],
): Promise<ActionResult<{ planId: string }>> {
  try {
    const profile = await requireRole("admin", "manager");
    uuidSchema.parse(planId);
    const input = z.array(serviceAreaSchema).parse(areas);

    const db = getDb();
    const plan = await db.query.plans.findFirst({ where: eq(plans.id, planId) });
    if (!plan) return err("Plan not found");

    await db.transaction(async (tx) => {
      await tx.delete(planServiceAreas).where(eq(planServiceAreas.planId, planId));
      if (input.length > 0) {
        await tx.insert(planServiceAreas).values(
          input.map((area) => ({ planId, state: area.state, county: area.county })),
        );
      }
      await writeAudit(tx, {
        actorId: profile.id,
        action: "plan.service_areas_set",
        entityType: "plan",
        entityId: planId,
        meta: { areaCount: input.length },
      });
    });

    revalidatePath("/", "layout");
    return ok({ planId });
  } catch (e) {
    return err(errorMessage(e));
  }
}

/** formData: pdf. The directory feeds the CARRIER's single network. */
export async function attachCarrierDirectory(
  carrierId: string,
  planYear: number,
  formData: FormData,
): Promise<ActionResult<{ carrierId: string; ingestionJobId: string }>> {
  try {
    const profile = await requireRole("admin", "manager");
    const input = z
      .object({ carrierId: uuidSchema, planYear: z.coerce.number().int().min(2020).max(2100) })
      .parse({ carrierId, planYear });
    const file = requirePdf(formData);

    const db = getDb();
    const [carrier] = await db.select().from(carriers).where(eq(carriers.id, carrierId));
    if (!carrier) return err("Carrier not found");

    const storagePath = `pharmacy-directories/carrier-${carrierId}-${input.planYear}.pdf`;
    await uploadObject(storagePath, new Uint8Array(await file.arrayBuffer()), "application/pdf");

    const { ingestionJobId } = await enqueueIngestionJob({
      kind: "pharmacy_directory",
      queue: QUEUE_NAMES.pharmacyDirectory,
      targetId: carrierId,
      payload: (jobId) => ({
        ingestionJobId: jobId,
        carrierId,
        planYear: input.planYear,
        storagePath,
      }),
    });

    await writeAudit(db, {
      actorId: profile.id,
      action: "carrier.pharmacy_directory_attached",
      entityType: "carrier",
      entityId: carrierId,
      meta: { storagePath, planYear: input.planYear, ingestionJobId },
    });

    revalidatePath("/", "layout");
    return ok({ carrierId, ingestionJobId });
  } catch (e) {
    return err(errorMessage(e));
  }
}

const LOGO_TYPES: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/svg+xml": "svg",
};
const MAX_LOGO_BYTES = 2 * 1024 * 1024;

/** formData: logo (png/jpeg/webp/svg, ≤2 MB). */
export async function uploadCarrierLogo(
  carrierId: string,
  formData: FormData,
): Promise<ActionResult<{ carrierId: string }>> {
  try {
    const profile = await requireRole("admin", "manager");
    uuidSchema.parse(carrierId);
    const file = formData.get("logo");
    if (!(file instanceof File) || file.size === 0) throw new Error("A logo image is required");
    const extension = LOGO_TYPES[file.type];
    if (!extension) throw new Error("Logo must be PNG, JPEG, WebP, or SVG");
    if (file.size > MAX_LOGO_BYTES) throw new Error("Logo exceeds the 2 MB limit");

    const db = getDb();
    const [carrier] = await db.select().from(carriers).where(eq(carriers.id, carrierId));
    if (!carrier) return err("Carrier not found");

    const logoPath = `carrier-logos/${carrierId}.${extension}`;
    await uploadObject(logoPath, new Uint8Array(await file.arrayBuffer()), file.type);
    await db.update(carriers).set({ logoPath }).where(eq(carriers.id, carrierId));

    await writeAudit(db, {
      actorId: profile.id,
      action: "carrier.logo_uploaded",
      entityType: "carrier",
      entityId: carrierId,
      meta: { logoPath },
    });

    revalidatePath("/", "layout");
    return ok({ carrierId });
  } catch (e) {
    return err(errorMessage(e));
  }
}

export async function removeCarrierLogo(
  carrierId: string,
): Promise<ActionResult<{ carrierId: string }>> {
  try {
    const profile = await requireRole("admin", "manager");
    uuidSchema.parse(carrierId);
    const db = getDb();
    const [updated] = await db
      .update(carriers)
      .set({ logoPath: null })
      .where(eq(carriers.id, carrierId))
      .returning({ id: carriers.id });
    if (!updated) return err("Carrier not found");

    await writeAudit(db, {
      actorId: profile.id,
      action: "carrier.logo_removed",
      entityType: "carrier",
      entityId: carrierId,
    });

    revalidatePath("/", "layout");
    return ok({ carrierId });
  } catch (e) {
    return err(errorMessage(e));
  }
}

/** formData: xlsx (the agency carrier workbook). */
export async function importCarrierWorkbook(
  carrierId: string,
  planYear: number,
  formData: FormData,
): Promise<ActionResult<{ ingestionJobId: string }>> {
  try {
    const profile = await requireRole("admin", "manager");
    const input = z
      .object({ carrierId: uuidSchema, planYear: z.coerce.number().int().min(2020).max(2100) })
      .parse({ carrierId, planYear });

    const file = formData.get("xlsx") ?? formData.get("file");
    if (!(file instanceof File) || file.size === 0) throw new Error("An .xlsx file is required");
    if (!file.name.toLowerCase().endsWith(".xlsx")) {
      throw new Error("Only .xlsx workbooks are accepted");
    }
    if (file.size > 25 * 1024 * 1024) throw new Error("Workbook exceeds the 25 MB limit");

    const db = getDb();
    const carrier = await db.select().from(carriers).where(eq(carriers.id, input.carrierId));
    if (!carrier[0]) return err("Carrier not found");

    const storagePath = `workbooks/${input.carrierId}-${input.planYear}.xlsx`;
    await uploadObject(
      storagePath,
      new Uint8Array(await file.arrayBuffer()),
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );

    const { ingestionJobId } = await enqueueIngestionJob({
      kind: "xlsx_import",
      queue: QUEUE_NAMES.xlsxImport,
      targetId: input.carrierId,
      payload: (jobId) => ({
        ingestionJobId: jobId,
        carrierId: input.carrierId,
        planYear: input.planYear,
        storagePath,
      }),
    });

    await writeAudit(db, {
      actorId: profile.id,
      action: "carrier.workbook_imported",
      entityType: "carrier",
      entityId: input.carrierId,
      meta: { planYear: input.planYear, fileName: file.name, ingestionJobId },
    });

    revalidatePath("/", "layout");
    return ok({ ingestionJobId });
  } catch (e) {
    return err(errorMessage(e));
  }
}

const cmsImportSchema = z.object({
  planYear: z.coerce.number().int().min(2020).max(2100),
  sourceUrl: z
    .string()
    .url()
    .refine((u) => u.startsWith("https://"), "The CMS download URL must be https"),
});

/**
 * Enqueue a CMS Quarterly PDP file import (pharmacy network status + tier-cost
 * prefill). The worker applies precedence: agent overrides always win, and
 * existing tier costs are never overwritten.
 */
export async function importCmsData(
  planYear: number,
  sourceUrl: string,
): Promise<ActionResult<{ ingestionJobId: string }>> {
  try {
    const profile = await requireRole("admin", "manager");
    const input = cmsImportSchema.parse({ planYear, sourceUrl });

    const { ingestionJobId } = await enqueueIngestionJob({
      kind: "cms_import",
      queue: QUEUE_NAMES.cmsImport,
      payload: (jobId) => ({
        ingestionJobId: jobId,
        planYear: input.planYear,
        sourceUrl: input.sourceUrl,
      }),
    });

    await writeAudit(getDb(), {
      actorId: profile.id,
      action: "plan.cms_import_enqueued",
      entityType: "cms_import",
      meta: { planYear: input.planYear, sourceUrl: input.sourceUrl, ingestionJobId },
    });

    revalidatePath("/", "layout");
    return ok({ ingestionJobId });
  } catch (e) {
    return err(errorMessage(e));
  }
}

/**
 * Wipe a carrier's pharmacy network for one plan year — the reset for stale
 * imports (old-schema directory/xlsx rows). Removes the carrier-level rows
 * AND the per-plan exception rows of that carrier's plans; the pharmacies
 * themselves stay. Rebuild by re-importing a directory or setting statuses.
 */
export async function clearCarrierPharmacyNetwork(
  carrierId: string,
  planYear: number,
): Promise<ActionResult<{ carrierRows: number; planRows: number }>> {
  try {
    const profile = await requireRole("admin", "manager");
    const input = z
      .object({ carrierId: uuidSchema, planYear: z.coerce.number().int().min(2020).max(2100) })
      .parse({ carrierId, planYear });

    const db = getDb();
    const [carrier] = await db.select().from(carriers).where(eq(carriers.id, input.carrierId));
    if (!carrier) return err("Carrier not found");

    const { carrierRows, planRows } = await db.transaction(async (tx) => {
      const deletedCarrierRows = await tx
        .delete(carrierPharmacyNetworks)
        .where(
          and(
            eq(carrierPharmacyNetworks.carrierId, input.carrierId),
            eq(carrierPharmacyNetworks.planYear, input.planYear),
          ),
        )
        .returning({ id: carrierPharmacyNetworks.id });

      const carrierPlans = await tx
        .select({ id: plans.id })
        .from(plans)
        .where(and(eq(plans.carrierId, input.carrierId), eq(plans.planYear, input.planYear)));
      const deletedPlanRows =
        carrierPlans.length > 0
          ? await tx
              .delete(planPharmacyNetworks)
              .where(inArray(planPharmacyNetworks.planId, carrierPlans.map((p) => p.id)))
              .returning({ id: planPharmacyNetworks.id })
          : [];

      await writeAudit(tx, {
        actorId: profile.id,
        action: "carrier.pharmacy_network_cleared",
        entityType: "carrier",
        entityId: input.carrierId,
        meta: {
          planYear: input.planYear,
          carrierRows: deletedCarrierRows.length,
          planRows: deletedPlanRows.length,
        },
      });
      return { carrierRows: deletedCarrierRows.length, planRows: deletedPlanRows.length };
    });

    revalidatePath("/", "layout");
    return ok({ carrierRows, planRows });
  } catch (e) {
    return err(errorMessage(e));
  }
}

/**
 * Seed a plan year's pharmacy network from the previous year. Rows land as
 * source "carryover" — an assumption, not a verification: a fresh directory
 * import for the new year overwrites them, and agent-set statuses outrank
 * them, exactly like any automated source. Refused when the target year
 * already has rows (clear it first) so a copy never silently merges.
 */
export async function copyCarrierNetworkFromPreviousYear(
  carrierId: string,
  planYear: number,
): Promise<ActionResult<{ copied: number; fromYear: number }>> {
  try {
    const profile = await requireRole("admin", "manager");
    const input = z
      .object({ carrierId: uuidSchema, planYear: z.coerce.number().int().min(2021).max(2100) })
      .parse({ carrierId, planYear });
    const fromYear = input.planYear - 1;

    const db = getDb();
    const [carrier] = await db.select().from(carriers).where(eq(carriers.id, input.carrierId));
    if (!carrier) return err("Carrier not found");

    const [targetCount] = await db
      .select({ value: count() })
      .from(carrierPharmacyNetworks)
      .where(
        and(
          eq(carrierPharmacyNetworks.carrierId, input.carrierId),
          eq(carrierPharmacyNetworks.planYear, input.planYear),
        ),
      );
    if ((targetCount?.value ?? 0) > 0) {
      return err(`${input.planYear} already has network rows — clear them first to re-copy`);
    }

    const sourceRows = await db
      .select({
        pharmacyId: carrierPharmacyNetworks.pharmacyId,
        status: carrierPharmacyNetworks.status,
      })
      .from(carrierPharmacyNetworks)
      .where(
        and(
          eq(carrierPharmacyNetworks.carrierId, input.carrierId),
          eq(carrierPharmacyNetworks.planYear, fromYear),
          eq(carrierPharmacyNetworks.staged, false),
        ),
      );
    if (sourceRows.length === 0) return err(`${fromYear} has no network to copy from`);

    await db.transaction(async (tx) => {
      await tx.insert(carrierPharmacyNetworks).values(
        sourceRows.map((row) => ({
          carrierId: input.carrierId,
          planYear: input.planYear,
          pharmacyId: row.pharmacyId,
          status: row.status,
          source: "carryover" as const,
        })),
      );
      await writeAudit(tx, {
        actorId: profile.id,
        action: "carrier.pharmacy_network_carried_over",
        entityType: "carrier",
        entityId: input.carrierId,
        meta: { fromYear, toYear: input.planYear, copied: sourceRows.length },
      });
    });

    revalidatePath("/", "layout");
    return ok({ copied: sourceRows.length, fromYear });
  } catch (e) {
    return err(errorMessage(e));
  }
}

const networkBulkSchema = z.object({
  carrierId: uuidSchema,
  planYear: z.coerce.number().int().min(2020).max(2100),
  pharmacyIds: z.array(uuidSchema).min(1).max(2000),
});

/** Bulk agent verification: one status across many pharmacies, one audit row. */
export async function setCarrierPharmacyStatusBulk(
  carrierId: string,
  planYear: number,
  pharmacyIds: string[],
  status: NetworkStatus,
): Promise<ActionResult<{ count: number }>> {
  try {
    const profile = await requireRole("admin", "manager");
    const input = networkBulkSchema
      .extend({ status: networkStatusSchema })
      .parse({ carrierId, planYear, pharmacyIds, status });

    const db = getDb();
    await db.transaction(async (tx) => {
      await tx
        .insert(carrierPharmacyNetworks)
        .values(
          input.pharmacyIds.map((pharmacyId) => ({
            carrierId: input.carrierId,
            planYear: input.planYear,
            pharmacyId,
            status: input.status,
            source: "agent" as const,
            verifiedBy: profile.id,
            verifiedAt: new Date(),
          })),
        )
        .onConflictDoUpdate({
          target: [
            carrierPharmacyNetworks.carrierId,
            carrierPharmacyNetworks.planYear,
            carrierPharmacyNetworks.pharmacyId,
          ],
          set: {
            status: input.status,
            source: "agent",
            verifiedBy: profile.id,
            verifiedAt: new Date(),
          },
        });
      await writeAudit(tx, {
        actorId: profile.id,
        action: "carrier.pharmacy_status_bulk_set",
        entityType: "carrier",
        entityId: input.carrierId,
        meta: { planYear: input.planYear, status: input.status, count: input.pharmacyIds.length },
      });
    });

    revalidatePath("/", "layout");
    return ok({ count: input.pharmacyIds.length });
  } catch (e) {
    return err(errorMessage(e));
  }
}

/**
 * Drop pharmacies from the network entirely — back to "not listed" (pricing
 * assumes standard), which is a different fact from an explicit
 * out-of-network status.
 */
export async function removeCarrierPharmacyRows(
  carrierId: string,
  planYear: number,
  pharmacyIds: string[],
): Promise<ActionResult<{ count: number }>> {
  try {
    const profile = await requireRole("admin", "manager");
    const input = networkBulkSchema.parse({ carrierId, planYear, pharmacyIds });

    const db = getDb();
    const removed = await db.transaction(async (tx) => {
      const rows = await tx
        .delete(carrierPharmacyNetworks)
        .where(
          and(
            eq(carrierPharmacyNetworks.carrierId, input.carrierId),
            eq(carrierPharmacyNetworks.planYear, input.planYear),
            inArray(carrierPharmacyNetworks.pharmacyId, input.pharmacyIds),
          ),
        )
        .returning({ id: carrierPharmacyNetworks.id });
      await writeAudit(tx, {
        actorId: profile.id,
        action: "carrier.pharmacy_network_rows_removed",
        entityType: "carrier",
        entityId: input.carrierId,
        meta: { planYear: input.planYear, count: rows.length },
      });
      return rows.length;
    });

    revalidatePath("/", "layout");
    return ok({ count: removed });
  } catch (e) {
    return err(errorMessage(e));
  }
}

/** Agent-verified status on the carrier's network — outranks every import. */
export async function setCarrierPharmacyStatus(
  carrierId: string,
  planYear: number,
  pharmacyId: string,
  status: NetworkStatus,
): Promise<ActionResult<{ carrierId: string; pharmacyId: string }>> {
  try {
    const profile = await requireRole("admin", "manager");
    const input = z
      .object({
        carrierId: uuidSchema,
        planYear: z.coerce.number().int().min(2020).max(2100),
        pharmacyId: uuidSchema,
        status: networkStatusSchema,
      })
      .parse({ carrierId, planYear, pharmacyId, status });

    const db = getDb();
    await db
      .insert(carrierPharmacyNetworks)
      .values({
        carrierId: input.carrierId,
        planYear: input.planYear,
        pharmacyId: input.pharmacyId,
        status: input.status,
        source: "agent",
        verifiedBy: profile.id,
        verifiedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [
          carrierPharmacyNetworks.carrierId,
          carrierPharmacyNetworks.planYear,
          carrierPharmacyNetworks.pharmacyId,
        ],
        set: { status: input.status, source: "agent", verifiedBy: profile.id, verifiedAt: new Date() },
      });

    await writeAudit(db, {
      actorId: profile.id,
      action: "carrier.pharmacy_status_set",
      entityType: "carrier",
      entityId: input.carrierId,
      meta: { pharmacyId: input.pharmacyId, status: input.status },
    });

    revalidatePath("/", "layout");
    return ok({ carrierId: input.carrierId, pharmacyId: input.pharmacyId });
  } catch (e) {
    return err(errorMessage(e));
  }
}
