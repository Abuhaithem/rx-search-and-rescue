/**
 * Creates or updates a sign-in-capable user directly in Postgres. Idempotent —
 * re-running with the same email resets the password/role. Also the way to add
 * agents until a user-management screen exists.
 *
 *   pnpm db:bootstrap <email> <password> [role=admin] [fullName]
 */
import "./load-env";
import { eq } from "drizzle-orm";
import { createDb } from "./client";
import { hashPassword } from "./passwords";
import { profiles, userRole } from "./schema";

const [emailArg, password, roleArg, fullNameArg] = process.argv.slice(2);

if (!emailArg || !password) {
  console.error("usage: pnpm db:bootstrap <email> <password> [role=admin] [fullName]");
  process.exit(1);
}
const email = emailArg.toLowerCase();
const role = (roleArg ?? "admin") as (typeof userRole.enumValues)[number];
if (!userRole.enumValues.includes(role)) {
  console.error(`role must be one of: ${userRole.enumValues.join(", ")}`);
  process.exit(1);
}
const fullName = fullNameArg ?? email.split("@")[0] ?? "Admin";

const db = createDb();
const passwordHash = await hashPassword(password);

const existing = await db.query.profiles.findFirst({ where: eq(profiles.email, email) });
if (existing) {
  await db
    .update(profiles)
    .set({ passwordHash, role })
    .where(eq(profiles.id, existing.id));
  console.log(`updated ${email} (password reset, role ${role})`);
} else {
  await db.insert(profiles).values({ email, fullName, role, passwordHash });
  console.log(`created ${email} with role ${role}`);
}
process.exit(0);
