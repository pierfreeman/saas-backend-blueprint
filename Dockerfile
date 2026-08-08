# ─── Unified multi-stage Dockerfile ───────────────────────────────────────────
# Builds any app in the monorepo via:
#   docker build --build-arg APP_NAME=api -t saas-api .
#   docker build --build-arg APP_NAME=admin-api -t saas-admin-api .
#   docker build --build-arg APP_NAME=worker-a -t saas-worker-a .
#
# Stages:
#   deps    → install production + dev dependencies (cached on lockfile)
#   prisma  → generate Prisma clients (cached on schema changes)
#   build   → Nx production build for one app
#   migrate → lightweight image for running prisma migrate deploy
#   runtime → minimal production image
# ──────────────────────────────────────────────────────────────────────────────

ARG NODE_VERSION=24
FROM node:${NODE_VERSION}-alpine AS base
WORKDIR /workspace

# ─── Stage 1: deps ── install all dependencies (cached on lockfile) ──────────
FROM base AS deps

COPY package.json package-lock.json ./

# BuildKit cache mount keeps the npm cache across builds so repeated
# installs (e.g. after a small lockfile change) are much faster.
RUN --mount=type=cache,target=/root/.npm \
    npm ci --ignore-scripts \
           --fetch-retries=5 \
           --fetch-retry-mintimeout=20000 \
           --fetch-retry-maxtimeout=120000

# ─── Stage 2: prisma ── generate Prisma clients (cached on schema changes) ──
FROM deps AS prisma

# Copy only what Prisma needs — this layer is cached until schemas change.
COPY prisma ./prisma
COPY prisma-legal ./prisma-legal
COPY prisma.config.ts prisma.config.legal.ts ./
COPY tsconfig.base.json ./

RUN DATABASE_URL=postgresql://dummy:dummy@localhost/dummy \
    LEGAL_AUDIT_DATABASE_URL=postgresql://dummy:dummy@localhost/dummy \
    npx prisma generate && \
    DATABASE_URL=postgresql://dummy:dummy@localhost/dummy \
    LEGAL_AUDIT_DATABASE_URL=postgresql://dummy:dummy@localhost/dummy \
    npx prisma generate --config prisma.config.legal.ts

# ─── Stage 3: build ── Nx production build for a single app ──────────────────
FROM prisma AS build

ARG APP_NAME=api

# Copy workspace config (Nx needs these to resolve projects).
COPY nx.json ./
COPY tsconfig.base.json ./

# Copy source — apps + libs. Changing source code only busts this layer,
# NOT deps or prisma generation above.
COPY apps ./apps
COPY libs ./libs

# Use BuildKit cache mount for the Nx cache so incremental rebuilds are fast
# even across Docker builds.
RUN --mount=type=cache,target=/workspace/.nx/cache \
    npx nx run ${APP_NAME}:build --configuration=production

# ─── Stage 4: migrate ── lightweight migration runner ────────────────────────
FROM base AS migrate

COPY package.json package-lock.json ./
COPY prisma ./prisma
COPY prisma-legal ./prisma-legal
COPY prisma.config.ts prisma.config.legal.ts ./
COPY tsconfig.base.json ./
COPY scripts ./scripts

RUN --mount=type=cache,target=/root/.npm \
    npm ci --ignore-scripts \
           --fetch-retries=5 \
           --fetch-retry-mintimeout=20000 \
           --fetch-retry-maxtimeout=120000

RUN chown -R node:node /workspace
USER node

# Default: deploy business DB migrations, then sync the app_runtime /
# app_admin_runtime role passwords (see
# prisma/migrations/20260808120000_enable_row_level_security and
# scripts/provision-runtime-roles.mjs). Requires APP_RUNTIME_DB_PASSWORD and
# APP_ADMIN_RUNTIME_DB_PASSWORD in the environment. Override via docker
# compose `command:` for the legal DB (no RLS/roles there, migrate only).
CMD ["sh", "-c", "npx prisma migrate deploy --config prisma.config.ts && node scripts/provision-runtime-roles.mjs"]

# ─── Stage 5: runtime ── minimal production image ────────────────────────────
FROM node:${NODE_VERSION}-alpine AS runtime

ARG APP_NAME=api
ENV NODE_ENV=production
ENV HOST=0.0.0.0

WORKDIR /app

# Copy the compiled app bundle.  Nx+webpack bundles everything into main.js,
# so we only need the dist output — no node_modules in production for the app
# services (Prisma v7 client is pure JS, bundled by webpack).
COPY --from=build /workspace/dist/apps/${APP_NAME} .

RUN chown -R node:node /app
USER node

CMD ["node", "main.js"]
