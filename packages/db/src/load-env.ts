/**
 * Minimal .env loader for standalone scripts (migrate, seed, worker).
 * Next.js loads .env itself; tsx does not — importing this module first makes
 * every entrypoint see the repo-root .env without a dotenv dependency.
 * Walks upward from cwd so it works from any package directory.
 * Real environment variables always win over file values.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

function findEnvFile(startDir: string): string | null {
  let dir = startDir;
  for (;;) {
    const candidate = path.join(dir, ".env");
    if (existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

const envPath = findEnvFile(process.cwd());
if (envPath) {
  for (const rawLine of readFileSync(envPath, "utf8").split("\n")) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}
