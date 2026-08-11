import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { NextConfig } from "next";

/**
 * Next.js only auto-loads .env from apps/web; this monorepo keeps a single
 * .env at the repo root. Load it here (config runs before compilation, so
 * NEXT_PUBLIC_* inlining and middleware both see the values). Kept inline
 * because next.config cannot import workspace TS. Real env vars win.
 */
function loadRootEnv() {
  let dir = process.cwd();
  for (;;) {
    const candidate = path.join(dir, ".env");
    if (existsSync(candidate)) {
      for (const rawLine of readFileSync(candidate, "utf8").split("\n")) {
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
      return;
    }
    const parent = path.dirname(dir);
    if (parent === dir) return;
    dir = parent;
  }
}
loadRootEnv();

const nextConfig: NextConfig = {
  transpilePackages: ["@rxsr/core", "@rxsr/db", "@rxsr/report"],
  experimental: {
    serverActions: {
      bodySizeLimit: "110mb", // formulary PDFs upload through server actions (100MB policy + form overhead)
    },
    // Server-action POSTs traverse the auth middleware, which has its OWN
    // body cap (default 10MB) — a larger upload gets truncated mid-stream
    // ("Unexpected end of form"). Keep this in lockstep with bodySizeLimit.
    middlewareClientMaxBodySize: 115343360, // 110MB
  },
};

export default nextConfig;
