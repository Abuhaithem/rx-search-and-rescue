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
- **packages/db** — Drizzle schema (source of truth), migrations, seed. Auth is
  self-hosted: `profiles` carries scrypt password hashes, `sessions` carries
  hashed bearer tokens.
- **packages/core** — pure domain logic: restriction grammar parser, analysis
  engine, pharmacy matching, report model. Deterministic; fully unit-tested.
- **packages/report** — ReportModel → .docx (institutional ink-on-paper style).
- **AWS** — RDS Postgres, S3 (PDFs + generated reports), EC2 + docker-compose
  (see `deploy/` and `docs/AWS_MIGRATION.md`). HIPAA note: accept the AWS BAA
  in AWS Artifact; client medication lists are PHI-adjacent.

## Setup

```bash
pnpm install
cp .env.example .env        # fill in RDS + S3 + Redis + extraction values
pnpm db:generate            # generate SQL migrations from the schema
pnpm db:migrate             # apply migrations to Postgres
pnpm db:bootstrap you@agency.com <password>   # first admin user (also resets passwords)
pnpm db:seed                # dev-only demo data (never in production)
```

Create a private S3 bucket for documents (or run MinIO/localstack locally) and
point `S3_BUCKET` / `AWS_REGION` at it.

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
