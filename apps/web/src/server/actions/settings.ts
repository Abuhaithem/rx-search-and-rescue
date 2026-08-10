"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { eq, getDb, hashPassword, profiles, verifyPassword } from "@rxsr/db";
import { err, errorMessage, ok, type ActionResult } from "../action-result";
import { invalidateOtherSessions, requireRole } from "../auth";
import { writeAudit } from "../audit";

const displayNameSchema = z.string().trim().min(2).max(80);

export async function updateDisplayName(name: string): Promise<ActionResult<{ name: string }>> {
  try {
    const profile = await requireRole();
    const fullName = displayNameSchema.parse(name);

    const db = getDb();
    await db.update(profiles).set({ fullName }).where(eq(profiles.id, profile.id));
    await writeAudit(db, {
      actorId: profile.id,
      action: "profile.name_updated",
      entityType: "profile",
      entityId: profile.id,
    });

    revalidatePath("/", "layout");
    return ok({ name: fullName });
  } catch (e) {
    return err(errorMessage(e));
  }
}

const passwordChangeSchema = z.object({
  currentPassword: z.string().min(1, "Current password is required"),
  newPassword: z
    .string()
    .min(10, "New password must be at least 10 characters")
    .max(200),
});

export async function changePassword(
  currentPassword: string,
  newPassword: string,
): Promise<ActionResult<null>> {
  try {
    const profile = await requireRole();
    const input = passwordChangeSchema.parse({ currentPassword, newPassword });

    const db = getDb();
    const row = await db.query.profiles.findFirst({ where: eq(profiles.id, profile.id) });
    if (!row?.passwordHash) return err("No password is set for this account");
    const valid = await verifyPassword(input.currentPassword, row.passwordHash);
    if (!valid) return err("Current password is incorrect");
    if (input.currentPassword === input.newPassword) {
      return err("The new password must differ from the current one");
    }

    const passwordHash = await hashPassword(input.newPassword);
    await db.update(profiles).set({ passwordHash }).where(eq(profiles.id, profile.id));
    // Kill every other device's session; this browser stays signed in.
    await invalidateOtherSessions(profile.id);

    await writeAudit(db, {
      actorId: profile.id,
      action: "profile.password_changed",
      entityType: "profile",
      entityId: profile.id,
    });

    return ok(null);
  } catch (e) {
    return err(errorMessage(e));
  }
}
