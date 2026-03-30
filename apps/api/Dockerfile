# ─── Stage 1: Builder ─────────────────────────────────────────────────────────
FROM node:25.8.0-alpine3.22 AS builder

WORKDIR /workspace

COPY package.json package-lock.json ./
COPY prisma ./prisma
COPY prisma-legal ./prisma-legal
COPY prisma.config.ts prisma.config.legal.ts ./

RUN npm ci --ignore-scripts --fetch-retries=5 --fetch-retry-mintimeout=20000 --fetch-retry-maxtimeout=120000

COPY tsconfig.base.json nx.json ./
COPY apps ./apps
COPY libs ./libs

RUN DATABASE_URL=postgresql://dummy:dummy@localhost/dummy \
    LEGAL_AUDIT_DATABASE_URL=postgresql://dummy:dummy@localhost/dummy \
    npx prisma generate && \
    DATABASE_URL=postgresql://dummy:dummy@localhost/dummy \
    LEGAL_AUDIT_DATABASE_URL=postgresql://dummy:dummy@localhost/dummy \
    npx prisma generate --config prisma.config.legal.ts && \
    npx nx run api:build --configuration=production --skip-nx-cache

# ─── Stage 2: Production ─────────────────────────────────────────────────────
FROM node:25.8.0-alpine3.22 AS production

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000

WORKDIR /app

COPY package.json package-lock.json ./
COPY prisma ./prisma

# Copy all node_modules from builder (includes prisma CLI needed for generate)
COPY --from=builder /workspace/node_modules ./node_modules

# Copy compiled app
COPY --from=builder /workspace/dist/apps/api .

# Generate Prisma client for this exact runtime is no longer needed in v7:
# the Rust-free client is pure JS/TS and is bundled by webpack into main.js.
RUN chown -R node:node /app
USER node

EXPOSE 3000

CMD ["node", "main.js"]
