/**
 * One-time project bootstrap: creates the private Storage bucket and the
 * first admin user. Idempotent — safe to re-run.
 *
 *   pnpm db:bootstrap <email> <password>
 *
 * Uses the Supabase service-role REST APIs directly (no extra deps).
 */
import "./load-env";
import { eq } from "drizzle-orm";
import { createDb } from "./client";
import { profiles } from "./schema";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const bucket = process.env.SUPABASE_STORAGE_BUCKET ?? "documents";
const [email, password] = process.argv.slice(2);

if (!url || !serviceKey) {
  console.error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env");
  process.exit(1);
}
if (!email || !password) {
  console.error("usage: pnpm db:bootstrap <email> <password>");
  process.exit(1);
}

const headers = {
  apikey: serviceKey,
  Authorization: `Bearer ${serviceKey}`,
  "Content-Type": "application/json",
};

// ── 1. Private storage bucket ───────────────────────────────────────────────
const bucketRes = await fetch(`${url}/storage/v1/bucket`, {
  method: "POST",
  headers,
  body: JSON.stringify({ id: bucket, name: bucket, public: false }),
});
if (bucketRes.ok) {
  console.log(`bucket "${bucket}" created`);
} else {
  const body = await bucketRes.text();
  if (bucketRes.status === 409 || body.includes("already exists")) {
    console.log(`bucket "${bucket}" already exists`);
  } else {
    console.error(`bucket creation failed (${bucketRes.status}): ${body}`);
    process.exit(1);
  }
}

// ── 2. Admin user ───────────────────────────────────────────────────────────
let userId: string | null = null;
const userRes = await fetch(`${url}/auth/v1/admin/users`, {
  method: "POST",
  headers,
  body: JSON.stringify({ email, password, email_confirm: true }),
});
const userBody = (await userRes.json()) as { id?: string; msg?: string; message?: string };
if (userRes.ok && userBody.id) {
  userId = userBody.id;
  console.log(`user ${email} created`);
} else if ((userBody.msg ?? userBody.message ?? "").includes("already")) {
  // Look the user up so we can still promote them.
  const list = await fetch(`${url}/auth/v1/admin/users?page=1&per_page=100`, { headers });
  const listBody = (await list.json()) as { users?: { id: string; email: string }[] };
  userId = listBody.users?.find((u) => u.email === email)?.id ?? null;
  console.log(`user ${email} already exists`);
} else {
  console.error(`user creation failed (${userRes.status}): ${JSON.stringify(userBody)}`);
  process.exit(1);
}
if (!userId) {
  console.error("could not resolve user id");
  process.exit(1);
}

// ── 3. Promote to admin (profile row is created by the auth trigger) ────────
const db = createDb();
const updated = await db
  .update(profiles)
  .set({ role: "admin" })
  .where(eq(profiles.id, userId))
  .returning({ id: profiles.id });
if (updated.length === 0) {
  // Trigger may not have fired for pre-existing users created before migration.
  await db
    .insert(profiles)
    .values({ id: userId, fullName: email.split("@")[0] ?? "Admin", role: "admin" })
    .onConflictDoUpdate({ target: profiles.id, set: { role: "admin" } });
}
console.log(`${email} is now an admin`);
process.exit(0);
