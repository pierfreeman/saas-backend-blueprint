FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
COPY prisma ./prisma/

RUN npm ci

COPY . .

RUN npm run prisma:generate
RUN npm run build

FROM node:20-alpine AS production

WORKDIR /app


COPY package*.json ./
COPY prisma ./prisma/

# Copy installed production dependencies from the builder stage to avoid
# re-install issues and ensure packages like `uuid` are present.
COPY --from=builder /app/node_modules ./node_modules

# Copy compiled app
COPY --from=builder /app/dist ./dist

# Copy entrypoint script and make it executable
COPY docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh

# Generate Prisma client for runtime (uses installed Prisma in node_modules)
RUN npx prisma generate

EXPOSE 3000

ENTRYPOINT ["/bin/sh", "./docker-entrypoint.sh"]
