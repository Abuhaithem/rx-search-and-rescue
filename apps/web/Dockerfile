# Build from the repo root: docker build -f apps/web/Dockerfile .
FROM node:22-alpine
RUN corepack enable
WORKDIR /app

# Manifests first so dependency install caches across source-only changes.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
COPY packages/report/package.json packages/report/
RUN pnpm install --frozen-lockfile --filter @rxsr/web...

COPY packages ./packages
COPY apps/web ./apps/web
RUN pnpm --filter @rxsr/web build

ENV NODE_ENV=production
EXPOSE 3000
CMD ["pnpm", "--filter", "@rxsr/web", "start"]
