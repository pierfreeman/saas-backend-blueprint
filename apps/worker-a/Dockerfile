# ─── Stage 1: Builder ─────────────────────────────────────────────────────────
FROM node:lts-alpine AS builder

WORKDIR /workspace

COPY package.json package-lock.json ./
COPY prisma ./prisma

RUN npm ci

COPY tsconfig.base.json nx.json jest.preset.js ./
COPY apps ./apps
COPY libs ./libs

RUN npx prisma generate
RUN npx nx run worker-a:build --configuration=production --skip-nx-cache

# ─── Stage 2: Production ─────────────────────────────────────────────────────
FROM node:lts-alpine AS production

ENV NODE_ENV=production

WORKDIR /app

COPY package.json package-lock.json ./
COPY prisma ./prisma

COPY --from=builder /workspace/node_modules ./node_modules
COPY --from=builder /workspace/dist/apps/worker-a .

RUN npx prisma generate

CMD ["node", "main.js"]
