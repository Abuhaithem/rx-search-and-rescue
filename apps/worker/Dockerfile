# Build from the repo root: docker build -f apps/worker/Dockerfile .
FROM node:22-alpine
# LibreOffice converts approved report .docx files to PDF (jobs/report-pdf).
# Liberation fonts keep Times/Arial metrics faithful in the output.
RUN apk add --no-cache libreoffice font-liberation && corepack enable
WORKDIR /app

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
COPY packages/report/package.json packages/report/
RUN pnpm install --frozen-lockfile --filter @rxsr/worker...

COPY packages ./packages
COPY apps/worker ./apps/worker

ENV NODE_ENV=production
CMD ["pnpm", "--filter", "@rxsr/worker", "start"]
