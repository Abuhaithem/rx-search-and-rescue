# Rx Search & Rescue

Medicare drug-coverage analysis for Insurance Specialists Group. Agents upload a
client's AgencyBloc Rx Collect PDF, compare 3–5 plans against the client's
medication list — priced at the client's own pharmacy across preferred retail /
standard retail / mail order channels — and generate an approved "Medicare
Analysis" Word report. Admin loads each plan year once (formularies, Summary of
Benefits tier costs, pharmacy directories); agents never open a formulary PDF.

**Find every drug. Rescue every plan choice.**

## Stack

- **apps/web** — Next.js 15 (App Router) + Tailwind v4 + hand-crafted shadcn-style
  design system. All data access through server actions (Drizzle). No AI calls.
- **apps/worker** — Node + BullMQ. The only component calling external APIs
  (Anthropic extraction, RxNorm normalization, NPPES pharmacy registry). AI runs
  at ingestion time only; running an analysis is a deterministic SQL join.
- **packages/db** — Drizzle schema (source of truth), migrations, RLS, seed.
- **packages/core** — pure domain logic: restriction grammar parser, analysis
  engine, pharmacy matching, report model. Deterministic; fully unit-tested.
- **packages/report** — ReportModel → .docx (institutional ink-on-paper style).
- **Supabase** — Postgres, Auth, Storage (PDFs + generated reports).
  HIPAA note: use a Team/Enterprise project with the HIPAA add-on + BAA; client
  medication lists are PHI-adjacent.

## Setup

```bash
pnpm install
cp .env.example .env        # fill in Supabase + Redis + provider values
pnpm db:generate            # generate SQL migrations from the schema
pnpm db:migrate             # apply migrations + RLS to Supabase Postgres
pnpm db:seed                # reference data: carriers + Idaho ZIP↔county rows
pnpm db:seed:demo           # OPTIONAL dev-only demo data (never in production)
```

`db:seed` is idempotent and safe on a live database (upserts only). It caches
the Census ZCTA↔county file under `packages/db/.cache/` so re-runs are
offline. `db:wipe:demo -- --yes` removes the demo data again (guarded dry-run
without `--yes`).

Create a Storage bucket named `documents` (private) in Supabase
(`pnpm db:bootstrap` does this).

Then load real data through the ingestion pipeline (worker must be running):

```bash
pnpm seed:pharmacies        # enqueue NPPES pharmacy seed for Idaho
pnpm ingest:formularies     # enqueue every carrier formulary PDF (supports --dry-run)
```

Formulary entries always flow through the ingestion pipeline (provenance +
admin QA) — never seeded directly. `plan_pharmacy_networks` comes from carrier
pharmacy-directory uploads or admin overrides — never seeded.

## Run

```bash
pnpm dev        # web app on :3000
pnpm worker     # ingestion worker (requires Redis + the selected provider's API key)
```

The worker's PDF extraction is provider-pluggable. Pick with
`EXTRACTION_PROVIDER` (`anthropic` — default — `openai`, or `gemini`) and set
that provider's API key (`ANTHROPIC_API_KEY` / `OPENAI_API_KEY` /
`GEMINI_API_KEY`). `EXTRACTION_MODEL` overrides the per-provider default
(claude-haiku-4-5 / gpt-5-mini / gemini-2.5-flash-lite);
`EXTRACTION_ESCALATION_MODEL` is the stronger model used to retry formulary
pages that fail the text-layer cross-check (empty disables escalation). All
providers pass the same zod validation gate from `@rxsr/core/intake`; see
`.env.example` for defaults and pricing notes. PHI caveat: only use providers
with a signed BAA.

## Develop

```bash
pnpm typecheck && pnpm test && pnpm build   # the gate for every change
```

Conventions live in `CLAUDE.md`; design system contract in `DESIGN_SYSTEM.md`;
server API surface in `docs/CONTRACTS.md`.
