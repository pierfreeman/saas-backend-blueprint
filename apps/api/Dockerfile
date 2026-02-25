# ─── Stage 1: Builder ─────────────────────────────────────────────────────────
FROM node:lts-alpine AS builder

WORKDIR /workspace

# Copy package manifests first for better layer caching
COPY package.json package-lock.json ./
COPY tsconfig.base.json nx.json jest.preset.js ./

# Copy prisma schema before install (postinstall may run prisma generate)
COPY prisma ./prisma

# Install all dependencies (dev included for the build)
RUN npm ci

# Copy source files
COPY apps ./apps
COPY libs ./libs

# Build only the api project (no cache available in CI, skip nx daemon)
RUN npx nx run api:build --configuration=production --skip-nx-cache

# ─── Stage 2: Migrator ────────────────────────────────────────────────────────
FROM builder AS migrator

WORKDIR /workspace

CMD ["npx", "prisma", "migrate", "deploy"]

# ─── Stage 3: Production ──────────────────────────────────────────────────────
FROM node:lts-alpine AS production

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000

WORKDIR /app

# Copy built output from builder
COPY --from=builder /workspace/dist/apps/api .

# Install only production dependencies from the pruned package.json
RUN npm install --omit=dev --ignore-scripts

EXPOSE 3000

CMD ["node", "main.js"]
