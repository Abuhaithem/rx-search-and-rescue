# AWS Architecture

Companion to [AWS_MIGRATION.md](AWS_MIGRATION.md). GitHub renders these
diagrams; locally use any Mermaid preview.

## The whole system

```mermaid
flowchart TB
    agent["👤 Agent's browser"]
    dns["DNS: app.yourdomain.com → Elastic IP"]

    subgraph aws["AWS account — BAA accepted in AWS Artifact"]
        subgraph vpc["VPC"]
            subgraph pub["Public subnet"]
                subgraph ec2["EC2 t4g.medium — docker compose"]
                    caddy["Caddy\n:80/:443, auto-TLS"]
                    web["web — Next.js\nserver actions, :3000"]
                    workerc["worker — BullMQ\ningestion jobs"]
                    redisc[("Redis\njob queue, IDs only")]
                end
            end
            subgraph priv["Private subnets (2 AZs)"]
                rds[("RDS Postgres 16\ndb.t4g.micro\nKMS-encrypted, force_ssl")]
            end
        end
        s3[("S3 private bucket\nSSE-KMS, versioned\nPDFs + reports")]
        iam["IAM instance role\ns3:Get/PutObject + SSM"]
        ssm["SSM Session Manager\n(shell access — no port 22)"]
        trail["CloudTrail\nmanagement events"]
    end

    anthropic["Extraction LLM\n(vendor with signed BAA)"]
    rxnorm["RxNorm API\n(NLM, public)"]
    nppes["NPPES NPI registry\n(CMS, public)"]

    agent -->|"HTTPS 443"| dns --> caddy
    caddy -->|"reverse proxy"| web
    agent -.->|"presigned GET (1 h)\nintake PDF viewer"| s3
    web -->|"enqueue job IDs"| redisc
    workerc -->|"consume jobs"| redisc
    web -->|"5432 · TLS\nSQL via Drizzle"| rds
    workerc -->|"5432 · TLS"| rds
    web -->|"upload / download\nvia instance role"| s3
    workerc -->|"download PDFs"| s3
    workerc -->|"HTTPS out"| anthropic
    workerc -->|"HTTPS out"| rxnorm
    workerc -->|"HTTPS out"| nppes
    iam -.->|"credentials"| ec2
    ssm -.-> ec2
```

Key boundaries:

- **Only Caddy is reachable from the internet** (80/443). Web, worker, and
  Redis live on the compose-internal network; RDS accepts 5432 only from the
  EC2 security group and is not publicly accessible.
- **The browser never talks to Postgres or external APIs** — everything goes
  through Next.js server actions. The one direct browser→AWS path is the
  time-limited presigned S3 GET used to render a stored intake PDF.
- **The worker is the only component calling external APIs** (extraction LLM,
  RxNorm, NPPES) — outbound only, via the instance's public IP (no NAT).
- **No credentials on disk**: S3 access comes from the IAM instance role;
  shell access is SSM Session Manager, so no SSH port exists.

## Flow 1 — intake: agent uploads an Rx Collect PDF

```mermaid
sequenceDiagram
    actor A as Agent
    participant W as web (server action)
    participant S3 as S3 bucket
    participant R as Redis (BullMQ)
    participant WK as worker
    participant DB as RDS Postgres
    participant LLM as Extraction LLM

    A->>W: uploadRxc(pdf) — session cookie checked (requireRole)
    W->>DB: insert clients row
    W->>S3: put rxc/(clientId).pdf
    W->>R: enqueue rxc job (IDs only, no PHI)
    W->>DB: audit_events: client.rxc_uploaded
    W-->>A: ok — client page (amber "processing")
    R->>WK: deliver job
    WK->>S3: get rxc/(clientId).pdf
    WK->>WK: deterministic RxC parse (LLM only as fallback)
    opt fallback / formulary ingestion
        WK->>LLM: page images → structured rows (zod-validated)
    end
    WK->>DB: medications with confidence + confirmed:false
    A->>W: review screen — confirm rows (human-in-the-loop)
    W->>DB: confirmed:true + audit event
```

## Flow 2 — analysis → approved Word report

```mermaid
sequenceDiagram
    actor A as Agent
    participant W as web (server action)
    participant DB as RDS Postgres
    participant S3 as S3 bucket

    A->>W: Run Comparison
    W->>DB: deterministic SQL join (no AI anywhere in this path)
    DB-->>W: coverage grid + tier costs
    A->>W: Approve
    W->>W: ReportModel → .docx (pure render)
    W->>S3: put reports/(analysisId).docx
    W->>DB: status=approved + audit event
    A->>W: Download report
    W->>S3: get reports/(analysisId).docx
    W-->>A: "Client — Medicare Analysis.docx"
```

## Who talks to whom

| From | To | Port / mechanism | Purpose |
|---|---|---|---|
| Browser | Caddy | 443 (TLS, HSTS) | the app |
| Browser | S3 | 443, presigned URL (1 h) | render stored intake PDF |
| Caddy | web | 3000, compose network | reverse proxy |
| web / worker | RDS | 5432, TLS enforced | all data (Drizzle) |
| web / worker | S3 | 443, instance role | PDFs + reports |
| web ↔ worker | Redis | 6379, compose network | job queue (IDs only) |
| worker | LLM / RxNorm / NPPES | 443 outbound | ingestion-time extraction + normalization |
| Operator | EC2 | SSM Session Manager | shell, deploys |

PHI lives in exactly three places: RDS (client + medication rows), S3 (source
PDFs, generated reports), and transiently at the extraction LLM during
ingestion — which is why that vendor needs its own BAA.
