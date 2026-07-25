import { eq } from "drizzle-orm";
import { getDb, profiles } from "@rxsr/db";
import type { UserRole } from "@rxsr/core";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export interface SessionProfile {
  id: string;
  fullName: string;
  role: UserRole;
}

export class AuthError extends Error {
  constructor(
    message: string,
    readonly code: "unauthenticated" | "forbidden",
  ) {
    super(message);
    this.name = "AuthError";
  }
}

/** Supabase session → profiles row. Null when not signed in (or no profile yet). */
export async function getSessionProfile(): Promise<SessionProfile | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  const row = await getDb().query.profiles.findFirst({
    where: eq(profiles.id, data.user.id),
  });
  if (!row) return null;
  return { id: row.id, fullName: row.fullName, role: row.role };
}

/**
 * Gate for every server action. No roles listed = any signed-in user.
 * Throws AuthError; actions catch it and return `err(...)`.
 */
export async function requireRole(...roles: UserRole[]): Promise<SessionProfile> {
  const profile = await getSessionProfile();
  if (!profile) throw new AuthError("You must be signed in", "unauthenticated");
  if (roles.length > 0 && !roles.includes(profile.role)) {
    throw new AuthError(`Requires ${roles.join(" or ")} role`, "forbidden");
  }
  return profile;
}
