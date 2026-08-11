"use server";

import { revalidatePath } from "next/cache";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import {
  analyses,
  analysisPharmacies,
  analysisPlans,
  analysisResults,
  clients,
  getDb,
  plans,
  reportOverrides,
} from "@rxsr/db";
import { runAnalysis, type CellResult } from "@rxsr/core/analysis";
import { generateReportDocx } from "@rxsr/report";
import { deleteObject, uploadObject } from "../storage";
import { err, errorMessage, ok, type ActionResult } from "../action-result";
import { requireRole } from "../auth";
import { writeAudit } from "../audit";
import { enqueueIngestionJob, QUEUE_NAMES } from "../enqueue";
import { loadComparisonInputs } from "../queries/comparison";
import { getCurrentDrugPlanId, isTierCostsComplete } from "../queries/plans";
import { buildReportModel } from "../report/build-model";
import { overridePathSchema } from "../schemas";

const uuidSchema = z.string().uuid();

const toStoredRestrictions = (restrictions: CellResult["restrictions"]) =>
  restrictions
    ? {
        pa: restrictions.pa,
        st: restrictions.st,
        ...(restrictions.ql ? { ql: restrictions.ql } : {}),
        extraFlags: restrictions.extraFlags,
      }
    : null;

export async function selectPlans(
  analysisId: string,
  planIds: string[],
  planYear: number,
): Promise<ActionResult<{ analysisId: string }>> {
  try {
    const profile = await requireRole();
    const input = z
      .object({
        analysisId: uuidSchema,
        planIds: z.array(uuidSchema).min(1).max(5),
        planYear: z.number().int().min(2020).max(2100),
      })
      .parse({ analysisId, planIds, planYear });

    const db = getDb();
    const analysis = await db.query.analyses.findFirst({ where: eq(analyses.id, input.analysisId) });
    if (!analysis) return err("Analysis not found");
    if (analysis.status === "approved" || analysis.status === "delivered") {
      return err("Plans cannot change after approval");
    }

    const planRows = await db.query.plans.findMany({
      where: inArray(plans.id, input.planIds),
      with: { formulary: true, tierCosts: true },
    });
    if (planRows.length !== input.planIds.length) return err("One or more plans not found");

    for (const plan of planRows) {
      if (plan.planYear !== input.planYear) {
        return err(`${plan.name} is a ${plan.planYear} plan — plan years never mix silently`);
      }
      if (!plan.formulary || plan.formulary.status !== "active") {
        return err(`${plan.name} has no active formulary — ingest and activate it first`);
      }
      if (!isTierCostsComplete(plan.tierCosts)) {
        return err(`${plan.name} is missing tier cost-sharing rows (tiers 1–5)`);
      }
    }

    const currentPlanId = await getCurrentDrugPlanId(analysis.clientId);

    await db.transaction(async (tx) => {
      await tx.delete(analysisPlans).where(eq(analysisPlans.analysisId, input.analysisId));
      await tx.insert(analysisPlans).values(
        input.planIds.map((planId, index) => ({
          analysisId: input.analysisId,
          planId,
          position: index,
          isCurrent: planId === currentPlanId,
        })),
      );
      await tx
        .update(analyses)
        .set({ planYear: input.planYear, updatedAt: new Date() })
        .where(eq(analyses.id, input.analysisId));
      await writeAudit(tx, {
        actorId: profile.id,
        action: "analysis.plans_selected",
        entityType: "analysis",
        entityId: input.analysisId,
        meta: { planIds: input.planIds, planYear: input.planYear },
      });
    });

    revalidatePath("/", "layout");
    return ok({ analysisId: input.analysisId });
  } catch (e) {
    return err(errorMessage(e));
  }
}

export async function runComparison(
  analysisId: string,
): Promise<ActionResult<{ analysisId: string }>> {
  try {
    const profile = await requireRole();
    uuidSchema.parse(analysisId);

    const inputs = await loadComparisonInputs(analysisId);
    if (!inputs) return err("Analysis not found");
    if (inputs.analysis.status === "approved" || inputs.analysis.status === "delivered") {
      return err("This analysis is already approved");
    }
    if (inputs.enginePlans.length === 0) return err("Select plans before running the comparison");
    if (inputs.engineMedications.length === 0) return err("The client has no medications to compare");

    const output = runAnalysis(inputs.engineMedications, inputs.enginePlans);

    const db = getDb();
    await db.transaction(async (tx) => {
      await tx.delete(analysisResults).where(eq(analysisResults.analysisId, analysisId));
      await tx.insert(analysisResults).values(
        output.cells.map((cell) => ({
          analysisId,
          medicationId: cell.medicationId,
          planId: cell.planId,
          coverage: cell.coverage,
          matchedEntryId: cell.matchedEntryId,
          matchMethod: cell.matchMethod,
          substitutionNote: cell.substitutionNote,
          tier: cell.tier,
          restrictions: toStoredRestrictions(cell.restrictions),
          needsConfirmation: cell.needsConfirmation,
        })),
      );
      await tx
        .update(analyses)
        .set({
          status: inputs.analysis.status === "new" ? "in_review" : inputs.analysis.status,
          updatedAt: new Date(),
        })
        .where(eq(analyses.id, analysisId));
      await writeAudit(tx, {
        actorId: profile.id,
        action: "analysis.comparison_run",
        entityType: "analysis",
        entityId: analysisId,
        meta: {
          planCount: inputs.enginePlans.length,
          medicationCount: inputs.engineMedications.length,
          cellCount: output.cells.length,
        },
      });
    });

    revalidatePath("/", "layout");
    return ok({ analysisId });
  } catch (e) {
    return err(errorMessage(e));
  }
}

/** Toggle the plan's mail-order channel as a row in the cost matrix. */
export async function setIncludeMailOrder(
  analysisId: string,
  include: boolean,
): Promise<ActionResult<{ analysisId: string }>> {
  try {
    const profile = await requireRole();
    const input = z
      .object({ analysisId: uuidSchema, include: z.boolean() })
      .parse({ analysisId, include });

    const db = getDb();
    const [updated] = await db
      .update(analyses)
      .set({ includeMailOrder: input.include, updatedAt: new Date() })
      .where(eq(analyses.id, input.analysisId))
      .returning({ id: analyses.id });
    if (!updated) return err("Analysis not found");

    await writeAudit(db, {
      actorId: profile.id,
      action: "analysis.mail_order_toggled",
      entityType: "analysis",
      entityId: input.analysisId,
      meta: { include: input.include },
    });

    revalidatePath("/", "layout");
    return ok({ analysisId: input.analysisId });
  } catch (e) {
    return err(errorMessage(e));
  }
}

/** Set which pharmacies are priced (the rows of the cost matrix), in order. */
export async function setComparisonPharmacies(
  analysisId: string,
  pharmacyIds: string[],
): Promise<ActionResult<{ analysisId: string }>> {
  try {
    const profile = await requireRole();
    const input = z
      .object({ analysisId: uuidSchema, pharmacyIds: z.array(uuidSchema).max(6) })
      .parse({ analysisId, pharmacyIds });

    const db = getDb();
    const analysis = await db.query.analyses.findFirst({ where: eq(analyses.id, input.analysisId) });
    if (!analysis) return err("Analysis not found");
    if (analysis.status === "approved" || analysis.status === "delivered") {
      return err("Pharmacies cannot change after approval");
    }

    // Dedupe while preserving order.
    const ordered = [...new Set(input.pharmacyIds)];

    await db.transaction(async (tx) => {
      await tx.delete(analysisPharmacies).where(eq(analysisPharmacies.analysisId, input.analysisId));
      if (ordered.length > 0) {
        await tx.insert(analysisPharmacies).values(
          ordered.map((pharmacyId, position) => ({
            analysisId: input.analysisId,
            pharmacyId,
            position,
          })),
        );
      }
      await tx
        .update(analyses)
        .set({ updatedAt: new Date() })
        .where(eq(analyses.id, input.analysisId));
      await writeAudit(tx, {
        actorId: profile.id,
        action: "analysis.pharmacies_set",
        entityType: "analysis",
        entityId: input.analysisId,
        meta: { pharmacyIds: ordered },
      });
    });

    revalidatePath("/", "layout");
    return ok({ analysisId: input.analysisId });
  } catch (e) {
    return err(errorMessage(e));
  }
}

export async function saveOverride(
  analysisId: string,
  path: string,
  value: unknown,
): Promise<ActionResult<{ analysisId: string }>> {
  try {
    const profile = await requireRole();
    const input = z
      .object({ analysisId: uuidSchema, path: overridePathSchema })
      .parse({ analysisId, path });
    if (value === undefined) return err("Override value is required");

    const db = getDb();
    await db
      .insert(reportOverrides)
      .values({
        analysisId: input.analysisId,
        path: input.path,
        value,
        editedBy: profile.id,
      })
      .onConflictDoUpdate({
        target: [reportOverrides.analysisId, reportOverrides.path],
        set: { value, editedBy: profile.id, updatedAt: new Date() },
      });

    await writeAudit(db, {
      actorId: profile.id,
      action: "analysis.override_saved",
      entityType: "analysis",
      entityId: input.analysisId,
      meta: { path: input.path },
    });

    revalidatePath("/", "layout");
    return ok({ analysisId: input.analysisId });
  } catch (e) {
    return err(errorMessage(e));
  }
}

export async function clearOverride(
  analysisId: string,
  path: string,
): Promise<ActionResult<{ analysisId: string }>> {
  try {
    const profile = await requireRole();
    const input = z
      .object({ analysisId: uuidSchema, path: z.string().min(1) })
      .parse({ analysisId, path });

    const db = getDb();
    await db
      .delete(reportOverrides)
      .where(
        and(
          eq(reportOverrides.analysisId, input.analysisId),
          eq(reportOverrides.path, input.path),
        ),
      );

    await writeAudit(db, {
      actorId: profile.id,
      action: "analysis.override_cleared",
      entityType: "analysis",
      entityId: input.analysisId,
      meta: { path: input.path },
    });

    revalidatePath("/", "layout");
    return ok({ analysisId: input.analysisId });
  } catch (e) {
    return err(errorMessage(e));
  }
}

export async function approveAnalysis(
  analysisId: string,
): Promise<ActionResult<{ reportPath: string }>> {
  try {
    const profile = await requireRole();
    uuidSchema.parse(analysisId);

    const db = getDb();
    const analysis = await db.query.analyses.findFirst({
      where: eq(analyses.id, analysisId),
      with: { results: { columns: { id: true }, limit: 1 } },
    });
    if (!analysis) return err("Analysis not found");
    if (analysis.status !== "in_review") {
      return err(`Only analyses in review can be approved (status: ${analysis.status})`);
    }
    if (analysis.results.length === 0) return err("Run the comparison before approving");

    const model = await buildReportModel(analysisId);
    if (!model) return err("Could not build the report model");

    const buffer = await generateReportDocx(model);
    const reportPath = `reports/${analysisId}.docx`;
    await uploadObject(
      reportPath,
      new Uint8Array(buffer),
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );

    await db.transaction(async (tx) => {
      await tx
        .update(analyses)
        .set({
          status: "approved",
          approvedBy: profile.id,
          approvedAt: new Date(),
          reportPath,
          reportPdfPath: null, // regenerated below from the fresh .docx
          updatedAt: new Date(),
        })
        .where(eq(analyses.id, analysisId));
      await writeAudit(tx, {
        actorId: profile.id,
        action: "analysis.approved",
        entityType: "analysis",
        entityId: analysisId,
        meta: { reportPath },
      });
    });

    await enqueueIngestionJob({
      kind: "report_pdf",
      queue: QUEUE_NAMES.reportPdf,
      targetId: analysisId,
      payload: (jobId) => ({ ingestionJobId: jobId, analysisId, docxPath: reportPath }),
    });

    revalidatePath("/", "layout");
    return ok({ reportPath });
  } catch (e) {
    return err(errorMessage(e));
  }
}

export async function markDelivered(
  analysisId: string,
): Promise<ActionResult<{ analysisId: string }>> {
  try {
    const profile = await requireRole();
    uuidSchema.parse(analysisId);

    const db = getDb();
    const analysis = await db.query.analyses.findFirst({ where: eq(analyses.id, analysisId) });
    if (!analysis) return err("Analysis not found");
    if (analysis.status !== "approved") return err("Only approved analyses can be delivered");

    await db.transaction(async (tx) => {
      await tx
        .update(analyses)
        .set({ status: "delivered", deliveredAt: new Date(), updatedAt: new Date() })
        .where(eq(analyses.id, analysisId));
      await writeAudit(tx, {
        actorId: profile.id,
        action: "analysis.delivered",
        entityType: "analysis",
        entityId: analysisId,
      });
    });

    revalidatePath("/", "layout");
    return ok({ analysisId });
  } catch (e) {
    return err(errorMessage(e));
  }
}

/**
 * Delete the analysis AND its client — medications, pharmacy links,
 * policies, results, and report overrides cascade with the client row;
 * stored PDFs/reports are removed from object storage best-effort.
 * PHI hygiene: once an analysis is delivered, only admin/manager may erase.
 */
export async function deleteClientAnalysis(
  analysisId: string,
): Promise<ActionResult<null>> {
  try {
    const profile = await requireRole();
    uuidSchema.parse(analysisId);

    const db = getDb();
    const analysis = await db.query.analyses.findFirst({
      where: eq(analyses.id, analysisId),
      with: { client: true },
    });
    if (!analysis) return err("Analysis not found");
    if (analysis.status === "delivered" && profile.role === "agent") {
      return err("Delivered analyses can only be deleted by a manager or admin");
    }

    const storagePaths = [
      analysis.client.sourceRxcPath,
      analysis.reportPath,
      analysis.reportPdfPath,
    ].filter((p): p is string => p !== null);

    await db.transaction(async (tx) => {
      await writeAudit(tx, {
        actorId: profile.id,
        action: "client.deleted",
        entityType: "client",
        entityId: analysis.clientId,
        meta: { clientName: analysis.client.fullName, analysisId, status: analysis.status },
      });
      await tx.delete(clients).where(eq(clients.id, analysis.clientId));
    });
    await Promise.all(storagePaths.map((path) => deleteObject(path)));

    revalidatePath("/", "layout");
    return ok(null);
  } catch (e) {
    return err(errorMessage(e));
  }
}
