"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb } from "@rxsr/db";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { err, errorMessage, ok, type ActionResult } from "../action-result";
import { getSessionProfile } from "../auth";
import { writeAudit } from "../audit";

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export async function signIn(
  email: string,
  password: string,
): Promise<ActionResult<{ profileId: string }>> {
  try {
    const credentials = credentialsSchema.parse({ email, password });
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.signInWithPassword(credentials);
    if (error || !data.user) return err(error?.message ?? "Invalid email or password");

    await writeAudit(getDb(), {
      actorId: data.user.id,
      action: "auth.signed_in",
      entityType: "profile",
      entityId: data.user.id,
    });
    revalidatePath("/", "layout");
    return ok({ profileId: data.user.id });
  } catch (e) {
    return err(errorMessage(e));
  }
}

export async function signOut(): Promise<ActionResult<null>> {
  try {
    const profile = await getSessionProfile();
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.signOut();
    if (error) return err(error.message);

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
