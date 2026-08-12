"use server";

import { createHash, randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import {
  getDb,
  hashPassword,
  passwordResetTokens,
  profiles,
  sessions,
  verifyPassword,
} from "@rxsr/db";
import { err, errorMessage, ok, type ActionResult } from "../action-result";
import { createSession, destroySession, getSessionProfile } from "../auth";
import { writeAudit } from "../audit";
import { appBaseUrl, isEmailEnabled, sendEmail } from "../email";
import { verifyTurnstileToken } from "../turnstile";

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

// One generic failure message for every branch: no user-enumeration oracle.
const INVALID_CREDENTIALS = "Invalid email or password";
const TURNSTILE_FAILED = "Human verification failed — reload the page and try again";

export async function signIn(
  email: string,
  password: string,
  turnstileToken?: string,
): Promise<ActionResult<{ profileId: string }>> {
  try {
    const credentials = credentialsSchema.parse({ email, password });
    if (!(await verifyTurnstileToken(turnstileToken))) return err(TURNSTILE_FAILED);
    const db = getDb();
    const profile = await db.query.profiles.findFirst({
      where: eq(profiles.email, credentials.email.toLowerCase()),
    });
    if (!profile?.passwordHash) {
      // Burn a hash anyway so the response time doesn't reveal missing users.
      await hashPassword(credentials.password);
      return err(INVALID_CREDENTIALS);
    }
    const valid = await verifyPassword(credentials.password, profile.passwordHash);
    if (!valid) return err(INVALID_CREDENTIALS);

    await createSession(profile.id);
    await writeAudit(db, {
      actorId: profile.id,
      action: "auth.signed_in",
      entityType: "profile",
      entityId: profile.id,
    });
    revalidatePath("/", "layout");
    return ok({ profileId: profile.id });
  } catch (e) {
    return err(errorMessage(e));
  }
}

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;
const hashResetToken = (token: string) => createHash("sha256").update(token).digest("hex");

/**
 * Always returns ok — whether the email exists, sending failed, or email is
 * unconfigured — so the response is never a user-enumeration oracle. Real
 * failures land in the server log and the audit trail.
 */
export async function requestPasswordReset(
  email: string,
  turnstileToken?: string,
): Promise<ActionResult<null>> {
  try {
    const parsedEmail = z.string().email().parse(email).toLowerCase();
    if (!(await verifyTurnstileToken(turnstileToken))) return err(TURNSTILE_FAILED);

    const db = getDb();
    const profile = await db.query.profiles.findFirst({
      where: eq(profiles.email, parsedEmail),
    });
    if (!profile?.email || !profile.passwordHash) return ok(null);
    if (!isEmailEnabled()) {
      console.error("Password reset requested but SES_FROM_ADDRESS is not set");
      return ok(null);
    }

    const token = randomBytes(32).toString("base64url");
    await db.transaction(async (tx) => {
      // One live token per user: a newer request voids the older link.
      await tx
        .delete(passwordResetTokens)
        .where(
          and(
            eq(passwordResetTokens.profileId, profile.id),
            isNull(passwordResetTokens.usedAt),
          ),
        );
      await tx.insert(passwordResetTokens).values({
        profileId: profile.id,
        tokenHash: hashResetToken(token),
        expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
      });
      await writeAudit(tx, {
        actorId: profile.id,
        action: "auth.password_reset_requested",
        entityType: "profile",
        entityId: profile.id,
      });
    });

    await sendEmail({
      to: profile.email,
      subject: "Reset your Rx Search & Rescue password",
      textBody: [
        `Hi ${profile.fullName},`,
        "",
        "Someone (hopefully you) asked to reset the password for this account.",
        "The link below works once and expires in 1 hour:",
        "",
        `${appBaseUrl()}/reset-password?token=${token}`,
        "",
        "If you didn't ask for this, ignore this email — your password is unchanged.",
        "",
        "Rx Search & Rescue — Insurance Specialists Group",
      ].join("\n"),
    });

    return ok(null);
  } catch (e) {
    // Same shape as success unless the input itself was malformed.
    if (e instanceof z.ZodError) return err("Enter a valid email address");
    console.error("Password reset request failed:", e);
    return ok(null);
  }
}

const resetPasswordSchema = z.object({
  token: z.string().min(20).max(200),
  newPassword: z.string().min(10, "Password must be at least 10 characters").max(200),
});

export async function resetPassword(
  token: string,
  newPassword: string,
): Promise<ActionResult<null>> {
  try {
    const input = resetPasswordSchema.parse({ token, newPassword });

    const db = getDb();
    const row = await db.query.passwordResetTokens.findFirst({
      where: eq(passwordResetTokens.tokenHash, hashResetToken(input.token)),
    });
    if (!row || row.usedAt !== null || row.expiresAt.getTime() <= Date.now()) {
      return err("This reset link is invalid or has expired — request a new one");
    }

    const passwordHash = await hashPassword(input.newPassword);
    await db.transaction(async (tx) => {
      await tx.update(profiles).set({ passwordHash }).where(eq(profiles.id, row.profileId));
      await tx
        .update(passwordResetTokens)
        .set({ usedAt: new Date() })
        .where(eq(passwordResetTokens.id, row.id));
      // Whoever held the old password loses every open session.
      await tx.delete(sessions).where(eq(sessions.profileId, row.profileId));
      await writeAudit(tx, {
        actorId: row.profileId,
        action: "auth.password_reset_completed",
        entityType: "profile",
        entityId: row.profileId,
      });
    });

    return ok(null);
  } catch (e) {
    return err(errorMessage(e));
  }
}

export async function signOut(): Promise<ActionResult<null>> {
  try {
    const profile = await getSessionProfile();
    await destroySession();

    if (profile) {
      await writeAudit(getDb(), {
        actorId: profile.id,
        action: "auth.signed_out",
        entityType: "profile",
        entityId: profile.id,
      });
    }
    revalidatePath("/", "layout");
    return ok(null);
  } catch (e) {
    return err(errorMessage(e));
  }
}
