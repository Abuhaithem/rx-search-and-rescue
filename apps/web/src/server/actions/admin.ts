"use server";

import { revalidatePath } from "next/cache";
import { and, count, eq, ne } from "drizzle-orm";
import { z } from "zod";
import {
  carriers,
  formularies,
  formularyEntries,
  getDb,
  planPharmacyNetworks,
  planServiceAreas,
  planTierCosts,
  plans,
} from "@rxsr/db";
import type { NetworkStatus } from "@rxsr/core";
import { uploadObject } from "../storage";
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

/** formData: pdf. */
export async function attachPharmacyDirectory(
  planId: string,
  formData: FormData,
): Promise<ActionResult<{ planId: string; ingestionJobId: string }>> {
  try {
    const profile = await requireRole("admin", "manager");
    uuidSchema.parse(planId);
    const file = requirePdf(formData);

    const db = getDb();
    const plan = await db.query.plans.findFirst({ where: eq(plans.id, planId) });
    if (!plan) return err("Plan not found");

    const storagePath = `pharmacy-directories/${planId}.pdf`;
    await uploadObject(storagePath, new Uint8Array(await file.arrayBuffer()), "application/pdf");

    await db
      .update(plans)
      .set({ pharmacyDirectoryPath: storagePath })
      .where(eq(plans.id, planId));

    const { ingestionJobId } = await enqueueIngestionJob({
      kind: "pharmacy_directory",
      queue: QUEUE_NAMES.pharmacyDirectory,
      targetId: planId,
      payload: (jobId) => ({ ingestionJobId: jobId, planIds: [planId], storagePath }),
    });

    await writeAudit(db, {
      actorId: profile.id,
      action: "plan.pharmacy_directory_attached",
      entityType: "plan",
      entityId: planId,
      meta: { storagePath, ingestionJobId },
    });

    revalidatePath("/", "layout");
    return ok({ planId, ingestionJobId });
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

export async function setPlanPharmacyStatus(
  planId: string,
  pharmacyId: string,
  status: NetworkStatus,
): Promise<ActionResult<{ planId: string; pharmacyId: string }>> {
  try {
    const profile = await requireRole("admin", "manager");
    const input = z
      .object({ planId: uuidSchema, pharmacyId: uuidSchema, status: networkStatusSchema })
      .parse({ planId, pharmacyId, status });

    const db = getDb();
    await db
      .insert(planPharmacyNetworks)
      .values({
        planId: input.planId,
        pharmacyId: input.pharmacyId,
        status: input.status,
        source: "agent",
        verifiedBy: profile.id,
        verifiedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [planPharmacyNetworks.planId, planPharmacyNetworks.pharmacyId],
        set: { status: input.status, source: "agent", verifiedBy: profile.id, verifiedAt: new Date() },
      });

    await writeAudit(db, {
      actorId: profile.id,
      action: "plan.pharmacy_status_set",
      entityType: "plan",
      entityId: input.planId,
      meta: { pharmacyId: input.pharmacyId, status: input.status },
    });

    revalidatePath("/", "layout");
    return ok({ planId: input.planId, pharmacyId: input.pharmacyId });
  } catch (e) {
    return err(errorMessage(e));
  }
}
