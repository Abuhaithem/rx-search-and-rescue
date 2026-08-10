"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { eq, getDb, hashPassword, profiles, verifyPassword } from "@rxsr/db";
import { err, errorMessage, ok, type ActionResult } from "../action-result";
import { createSession, destroySession, getSessionProfile } from "../auth";
import { writeAudit } from "../audit";

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

// One generic failure message for every branch: no user-enumeration oracle.
const INVALID_CREDENTIALS = "Invalid email or password";

export async function signIn(
  email: string,
  password: string,
): Promise<ActionResult<{ profileId: string }>> {
  try {
    const credentials = credentialsSchema.parse({ email, password });
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
