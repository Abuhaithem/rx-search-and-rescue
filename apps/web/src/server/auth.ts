import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { and, eq, ne } from "drizzle-orm";
import { getDb, profiles, sessions } from "@rxsr/db";
import type { UserRole } from "@rxsr/core";

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

export const SESSION_COOKIE = "rxsr_session";
// One workday: PHI on shared agency machines must not stay unlocked for weeks.
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;

// The cookie carries the raw token; the DB only ever sees its hash, so a DB
// leak cannot be replayed as a session.
const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export async function createSession(profileId: string): Promise<void> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await getDb().insert(sessions).values({ profileId, tokenHash: hashToken(token), expiresAt });
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export async function destroySession(): Promise<void> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (token) {
    await getDb().delete(sessions).where(eq(sessions.tokenHash, hashToken(token)));
  }
  cookieStore.delete(SESSION_COOKIE);
}

/** Session cookie → profiles row. Null when not signed in or expired. */
export async function getSessionProfile(): Promise<SessionProfile | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const [row] = await getDb()
    .select({
      id: profiles.id,
      fullName: profiles.fullName,
      role: profiles.role,
      sessionId: sessions.id,
      expiresAt: sessions.expiresAt,
    })
    .from(sessions)
    .innerJoin(profiles, eq(profiles.id, sessions.profileId))
    .where(eq(sessions.tokenHash, hashToken(token)))
    .limit(1);
  if (!row) return null;

  if (row.expiresAt.getTime() <= Date.now()) {
    await getDb().delete(sessions).where(eq(sessions.id, row.sessionId));
    return null;
  }
  return { id: row.id, fullName: row.fullName, role: row.role };
}

/** After a password change: every other device's session dies, this one stays. */
export async function invalidateOtherSessions(profileId: string): Promise<void> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  const db = getDb();
  if (token) {
    const keep = hashToken(token);
    await db
      .delete(sessions)
      .where(and(eq(sessions.profileId, profileId), ne(sessions.tokenHash, keep)));
  } else {
    await db.delete(sessions).where(eq(sessions.profileId, profileId));
  }
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
