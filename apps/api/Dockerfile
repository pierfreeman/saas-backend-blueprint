# ─── Stage 1: Builder ─────────────────────────────────────────────────────────
FROM node:lts-alpine AS builder

WORKDIR /workspace

COPY package.json package-lock.json ./
COPY prisma ./prisma

RUN --mount=type=cache,target=/root/.npm \
    npm ci --fetch-retries=5 --fetch-retry-mintimeout=20000 --fetch-retry-maxtimeout=120000

COPY tsconfig.base.json nx.json jest.preset.js ./
COPY apps ./apps
COPY libs ./libs

RUN npx prisma generate
RUN npx prisma generate --schema prisma/schema.legal.prisma
RUN npx nx run api:build --configuration=production --skip-nx-cache

# ─── Stage 2: Production ─────────────────────────────────────────────────────
FROM node:lts-alpine AS production

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

# Generate Prisma client for this exact runtime (same as saas-backend-blueprint approach)
RUN npx prisma generate
RUN npx prisma generate --schema prisma/schema.legal.prisma

EXPOSE 3000

CMD ["node", "main.js"]
