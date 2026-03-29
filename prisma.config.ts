// ─── Business DB config ──────────────────────────────────────────────────────
// Auto-detected by all `npx prisma` commands (no --config flag needed).
// Reads DATABASE_URL from .env  →  postgres container, port 5432.
//
// For the Legal Audit DB, use the companion config file:
//   npx prisma migrate dev    --config prisma.config.legal.ts [--name …]
//   npx prisma migrate deploy --config prisma.config.legal.ts
//   npx prisma generate       --config prisma.config.legal.ts
//   npx prisma studio         --config prisma.config.legal.ts
// ─────────────────────────────────────────────────────────────────────────────
import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: env('DATABASE_URL'),
  },
});
