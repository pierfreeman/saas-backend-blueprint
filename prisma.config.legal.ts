// ─── Legal Audit DB config ────────────────────────────────────────────────────
// Used by all `npx prisma` commands via `--config prisma.config.legal.ts`.
// Reads LEGAL_AUDIT_DATABASE_URL from .env  →  postgres-legal container, port 5433.
//
// Examples:
//   npx prisma migrate dev    --config prisma.config.legal.ts [--name …]
//   npx prisma migrate deploy --config prisma.config.legal.ts
//   npx prisma generate       --config prisma.config.legal.ts
//   npx prisma studio         --config prisma.config.legal.ts
//
// ⚠️  Append-only database — do NOT issue UPDATE or DELETE statements.
// ─────────────────────────────────────────────────────────────────────────────
import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

export default defineConfig({
  schema: 'prisma-legal/schema.prisma',
  migrations: {
    path: 'prisma/migrations-legal',
  },
  datasource: {
    url: env('LEGAL_AUDIT_DATABASE_URL'),
  },
});
