# Deployment

Routine deploys to the production EC2 box. One-time infrastructure setup
(VPC, RDS, S3, IAM, DNS) lives in [AWS_MIGRATION.md](AWS_MIGRATION.md).

## The stack, in one paragraph

One EC2 instance runs everything via docker compose (`deploy/`): **caddy**
(HTTPS, auto-certificates), **web** (Next.js), **worker** (BullMQ jobs — AI
extraction, PDF conversion), **redis** (job queue). Postgres is RDS,
files are S3. Configuration lives in `~/rx-search-and-rescue/.env` on the
box — never in the repo.

## Standard deploy (every code change)

Connect via **SSM Session Manager** (EC2 console → instance → Connect →
Session Manager — there is no SSH port), then:

```bash
sudo su - ubuntu
cd ~/rx-search-and-rescue
git pull
cd deploy
docker compose up -d --build
docker compose exec web pnpm db:migrate
```

That is the whole deploy. Notes:

- **Always run `db:migrate`.** It is idempotent: it applies only pending
  migrations and prints "migrations applied" instantly when there is
  nothing to do. Skipping it after a schema change causes
  `column … does not exist` crashes (the generic "Application error" page
  with a digest).
- **Always `--build`.** A plain `up -d` restarts the old images; code
  changes only take effect after a rebuild. Builds take ~5–10 minutes on
  the t4g (longer the first time after the worker image gained
  LibreOffice); the site stays up on the old containers until the new ones
  swap in.
- Order matters: migrate **after** the new containers are up — the command
  runs inside the new web image, which contains the new migration files.

## Verify

```bash
docker compose ps                          # caddy, web, worker, redis all "Up"
docker compose exec web pnpm db:migrate    # second run → "migrations applied" instantly
```

Then in the browser: sign in, open **Carriers**, and if the change touched
ingestion, run one small upload end-to-end and watch its progress line.

## Environment changes (no code deploy)

Editing `~/rx-search-and-rescue/.env` (extraction model, API keys,
`SITE_ADDRESS`, …) needs a restart but **no rebuild**:

```bash
cd ~/rx-search-and-rescue/deploy
docker compose up -d
```

Reference of what belongs in `.env`: see `.env.example` in the repo root.
Real values never go into `.env.example` — it is the committed template.

## Reading logs / diagnosing failures

```bash
docker compose logs web --tail=100      # server errors (the "digest" pages land here)
docker compose logs worker --tail=100   # extraction/ingestion job errors
docker compose logs caddy --tail=50     # TLS / certificate issues
docker compose logs web --since=2m      # reproduce an error, then read what just happened
```

Common signatures:

| Symptom | Cause | Fix |
|---|---|---|
| "Application error … Digest: N" page | server exception — read `logs web` | usually a skipped `db:migrate` |
| `column … does not exist` in logs | migrations behind the code | `docker compose exec web pnpm db:migrate` |
| Upload job stuck on "queued" | worker container down | `docker compose ps`, `docker compose up -d` |
| Job failed: `…_API_KEY is not set` | extraction key missing in `.env` | add key, `docker compose up -d` |
| "Unexpected end of form" | upload larger than the configured body limits | limits live in `apps/web/next.config.ts` (110 MB) — a bigger file needs a code change |
| Browser can't reach the site / cert errors | DNS not pointing at the Elastic IP, or Cloudflare proxy enabled | fix the A record; Cloudflare must be "DNS only" |

## Rollback

Deploys are plain git — roll back by checking out the previous commit and
rebuilding:

```bash
cd ~/rx-search-and-rescue
git log --oneline -5          # find the last good commit
git checkout <good-sha>
cd deploy && docker compose up -d --build
```

Caveat: **migrations are not rolled back.** They are written to be
backward-compatible (new columns are nullable or defaulted), so old code
runs against a newer schema. Return to `main` with `git checkout main`
once fixed.

## User management

```bash
# create a user, or reset an existing user's password (idempotent)
docker compose exec web pnpm db:bootstrap someone@agency.com 'NewPassword' agent "Full Name"
# roles: admin | manager | agent (default admin when omitted)
```

Users change their own password at `/settings`; the bootstrap command is
the admin-side reset. Clear the shell history afterwards: `history -c`.

## Maintenance cadence

- **Monthly:** `docker compose build --pull && docker compose up -d` —
  picks up Node/Alpine base-image security patches. OS patches are
  automatic (`unattended-upgrades`).
- **RDS backups** are automatic (14-day point-in-time). Test a snapshot
  restore once.
- **Disk:** old Docker images accumulate; `docker system prune -f` after
  a few deploys keeps the 30 GB volume comfortable.
