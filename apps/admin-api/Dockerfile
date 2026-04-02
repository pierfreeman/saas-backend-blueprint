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
    npx nx run admin-api:build --configuration=production --skip-nx-cache

# ─── Stage 2: Production ─────────────────────────────────────────────────────
FROM node:25.8.0-alpine3.22 AS production

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3001

WORKDIR /app

COPY package.json package-lock.json ./
COPY prisma ./prisma

COPY --from=builder /workspace/node_modules ./node_modules
COPY --from=builder /workspace/dist/apps/admin-api .

RUN chown -R node:node /app
USER node

EXPOSE 3001

CMD ["node", "main.js"]
