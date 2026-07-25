# Rx Search & Rescue — Engineering Conventions

Medicare drug-coverage analysis tool for an insurance agency. Replaces a manual
workflow producing "Medicare Analysis" Word documents. Agents upload a client's
AgencyBloc Rx Collect PDF, compare 3–5 plans against the client's medications,
and generate an approved Word report. HIPAA-adjacent data: client names + med
lists are PHI. Human-in-the-loop everywhere: AI-extracted data is never trusted
until an agent confirms it.

## Architecture (non-negotiable boundaries)

- `apps/web` — Next.js 15 App Router. ALL data access via server actions /
  server components using Drizzle (`@rxsr/db`). The browser NEVER talks to
  Postgres or external APIs. No AI calls anywhere in this app.
- `apps/worker` — the ONLY component calling external APIs (Anthropic, RxNorm,
  NPPES). BullMQ consumers. AI runs at ingestion time only.
- `packages/db` — Drizzle schema = the single source of truth for data shapes.
- `packages/core` — pure domain logic. No I/O, no env reads, no Date.now() in
  logic paths. The analysis engine and restriction parser live here and are
  deterministic: same input, same output, always.
- `packages/report` — ReportModel → .docx. Pure render, no logic.

Analysis is a SQL join over pre-ingested data — if you find yourself wanting an
LLM call in the analysis or render path, stop; that's a rejected design.

## Conventions

- TypeScript strict; no `any` unless interfacing with an untyped lib (comment why).
- Money is integer cents (`Cents` type). Never floats. Display via helpers.
- All AI output is validated with zod schemas from `@rxsr/core/intake` before
  touching the DB, lands with `confidence` + `confirmed: false`, and surfaces
  amber in the UI until an agent confirms.
- Provenance everywhere: extracted rows keep `sourcePage` + verbatim raw text;
  analysis cells keep `matchedEntryId` + `matchMethod`.
- Plan-year versioning: nothing compares across plan years silently.
- Server actions: one file per domain in `apps/web/src/server/actions/`,
  validate inputs with zod, check role from the caller's Supabase session,
  return `{ ok: true, data } | { ok: false, error }` (type `ActionResult<T>`).
  Write an `audit_events` row for every state-changing action.
- Naming: DB snake_case, TS camelCase, components PascalCase. No abbreviations
  in public APIs ("medication", not "med").
- Comments only for constraints the code can't express. No narration, no
  "this function does X".
- Match existing file/module patterns before inventing new ones. When in doubt,
  read a sibling file first.

## UI rules (from Brand Identity — see DESIGN_SYSTEM.md)

- Rescue orange appears EXACTLY ONCE per screen — on the action that completes
  the job (Run Comparison, Approve, Activate). Everything else is Deep Water
  ink, Fog surfaces, Steel text.
- Coverage colors (covered/restricted/notcovered) are reserved for coverage
  meaning. Never decorative.
- All numbers/tiers/ZIPs/plan IDs render in Plex Mono (`text-data` utility).
  Headings in Archivo heavy weights (`font-display`). Body in Public Sans.
- Client-facing report artifacts: ink on paper only — no orange, ever.

## Commands

- `pnpm typecheck` / `pnpm build` / `pnpm test` — must ALL pass before a task
  is considered done.
- `pnpm db:generate` — regenerate Drizzle migrations after schema changes.
- DB env not available during development in this sandbox: do NOT try to run
  migrations/seed against a live DB; typecheck + unit tests are the gate.

## Testing

- Vitest. Pure logic in `packages/core` gets exhaustive unit tests.
- Golden fixtures live in `packages/core/test/fixtures` — derived from the real
  sample set (Bentley/Brown reports, sample formulary rows). The Bentley
  analysis reproduction test is the product's ground truth.
- No network in tests. Worker API clients take a fetch-like injectable.
