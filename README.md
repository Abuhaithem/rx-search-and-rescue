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
cp .env.example .env        # fill in Supabase + Redis + Anthropic values
pnpm db:generate            # generate SQL migrations from the schema
pnpm db:migrate             # apply migrations + RLS to Supabase Postgres
pnpm db:seed                # dev-only demo data (never in production)
```

Create a Storage bucket named `documents` (private) in Supabase.

## Run

```bash
pnpm dev        # web app on :3000
pnpm worker     # ingestion worker (requires Redis + ANTHROPIC_API_KEY)
```

## Develop

```bash
pnpm typecheck && pnpm test && pnpm build   # the gate for every change
```

Conventions live in `CLAUDE.md`; design system contract in `DESIGN_SYSTEM.md`;
server API surface in `docs/CONTRACTS.md`.
