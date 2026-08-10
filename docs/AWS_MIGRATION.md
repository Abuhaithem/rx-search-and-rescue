# AWS Migration Runbook

Target: single EC2 instance (web + worker + Redis + Caddy via docker-compose),
RDS Postgres, private S3 bucket. Everything PHI-touching stays inside one VPC
under one AWS BAA. Estimated cost ~$45–55/mo (t4g.medium + db.t4g.micro,
single-AZ, us-east-1 on-demand).

The code no longer references Supabase anywhere — auth is DB-backed sessions
(`profiles.password_hash` + `sessions`), storage is S3, and Postgres is a plain
`DATABASE_URL`. What remains is infrastructure plus a one-time data move.

## 1. Compliance first

- In **AWS Artifact → Agreements**, accept the AWS Business Associate Addendum
  (self-service, free) on the account *before* any PHI lands in it.
- Confirm the extraction LLM vendor BAA is in place (`EXTRACTION_PROVIDER`) —
  that vendor sees client names + medication lists at ingestion time.
- Keep using services on the HIPAA-eligible list only: EC2, RDS, S3,
  ElastiCache (unused), ALB (unused), KMS, CloudTrail, SSM.

## 2. Network layout (one VPC)

- VPC with 2 public + 2 private subnets (two AZs — RDS subnet groups require
  two even for single-AZ).
- **EC2 app instance** in a public subnet. Security group inbound: 443 and 80
  (Caddy redirects 80→443) from anywhere. **No port 22** — use SSM Session
  Manager for shell access.
- **RDS** in the private subnets. Security group inbound: 5432 from the app
  instance's security group only. Not publicly accessible.
- No NAT gateway needed: the app instance has a public IP for outbound calls
  (extraction provider, RxNorm, NPPES).

## 3. RDS Postgres

- `db.t4g.micro`, single-AZ, 20 GB gp3, storage encrypted (KMS), Postgres 16.
- Parameter group: `rds.force_ssl = 1`.
- Automated backups: 14-day retention (point-in-time recovery included).
- Create the app database/user, then set `DATABASE_URL` with `?sslmode=require`.

## 4. S3 bucket

- One private bucket, e.g. `rxsr-documents-<account-id>`.
- Block Public Access: all four settings ON. Default encryption: SSE-KMS.
- Enable versioning (cheap undo for overwritten reports).
- Object keys are exactly the paths already stored in the DB:
  `rxc/<clientId>.pdf`, `formularies/<id>.pdf`, `pharmacy-directories/<planId>.pdf`,
  `reports/<analysisId>.docx` — copy objects 1:1 and nothing in the DB changes.

## 5. IAM

Instance role for the EC2 box (no access keys on disk):

- `s3:GetObject`, `s3:PutObject` on `arn:aws:s3:::<bucket>/*`
- `AmazonSSMManagedInstanceCore` (Session Manager)

The app reads credentials via the default AWS chain — `S3_BUCKET` and
`AWS_REGION` are the only storage env vars.

## 6. EC2 instance

- `t4g.medium` (arm64), Ubuntu 24.04 LTS, 30 GB gp3, the instance role above.
- Install Docker + compose plugin; enable `unattended-upgrades`.
- Clone the repo, `cp .env.example .env`, fill in real values
  (`SITE_ADDRESS=app.yourdomain.com`).
- Point DNS at the instance (Elastic IP so the address survives restarts).
- `cd deploy && docker compose up -d --build` — Caddy provisions TLS itself.
- Run migrations from the box: `pnpm db:migrate`.

## 7. Data migration (the cutover)

Order matters: DB → objects → users → DNS. Do it during off-hours; the old
system stays read-only from step 1.

1. **Freeze**: stop using the Supabase deployment (announce read-only).
2. **Database**: dump only the app schema — Supabase's `auth`/`storage`
   schemas stay behind:
   ```bash
   pg_dump "$SUPABASE_DATABASE_URL" --schema=public --no-owner --no-privileges \
     -Fc -f rxsr.dump
   pg_restore -d "$RDS_DATABASE_URL" --no-owner --no-privileges rxsr.dump
   ```
3. **Objects**: mirror the `documents` bucket into S3 with the same keys.
   Download via Supabase CLI/dashboard (or a small script against the Storage
   API with the service key), then:
   ```bash
   aws s3 sync ./documents "s3://$S3_BUCKET/"
   ```
4. **Users**: Supabase password hashes are not exported — every user gets a
   fresh password. First backfill emails onto profiles (run against Supabase,
   apply the output to RDS):
   ```sql
   select format('update profiles set email = %L where id = %L;',
                 lower(u.email), u.id)
   from auth.users u;
   ```
   Then set passwords (also serves as the break-glass reset):
   ```bash
   pnpm db:bootstrap agent@agency.com <new-password> agent "Agent Name"
   ```
5. **Verify** on the new URL: sign in, open an existing client (source PDF
   renders — S3 presigned URL works), download an existing report, upload a
   test RxC, run a comparison, approve, download the new report.
6. **DNS** to the Elastic IP; decommission the Supabase project after a
   two-week soak (export a final backup first).

## 8. Post-migration hardening

- CloudTrail: one management-events trail (free tier) for the audit story.
- CloudWatch agent for system logs; never log request bodies (PHI).
- RDS + S3 encryption verified; snapshot restore tested once.
- Patch cadence: `unattended-upgrades` for the OS, rebuild images monthly for
  Node/base-image updates (`docker compose build --pull`).
- Consider AWS Backup for a second copy of RDS snapshots.

## Rollback

Before step 6 (DNS), rollback = do nothing: the old deployment is untouched.
After DNS, rollback = point DNS back; reconcile any rows created on RDS in the
interim (audit_events gives the exact delta).
