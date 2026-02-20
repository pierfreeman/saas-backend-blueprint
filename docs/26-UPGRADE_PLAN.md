# Gradual Upgrade Plan - Multi-tenant SaaS Backend Blueprint

**Start date**: February 13, 2026  
**Status**: In Progress - Step 1 Completed

---

## Step 1: Patch/Minor Updates (COMPLETED)

### Applied Updates

- `ioredis`: 5.3.2 → 5.9.3 (minor update, bug fixes)

### Testing Required

- [ ] Verify Redis connection working
- [ ] Test pub/sub for notifications
- [ ] Verify cache throttling

### Test Commands

```bash
npm run test:unit
npm run start:dev
# Manually test Redis connection
```

---

## Step 2: NestJS v10 → v11 Upgrade (NEXT)

### Required Preparation

#### 1. Verify System Requirements

- [ ] Node.js >= 18.19.0 or >= 20.6.0 (current: check)
- [ ] TypeScript >= 5.2 (current: 5.3.3)

#### 2. Read Migration Guide

- [ ] [NestJS v11 Release Notes](https://docs.nestjs.com/migration-guide)
- [ ] Verify specific breaking changes

#### 3. Backup

- [ ] Commit current work to git
- [ ] Dedicated branch: `git checkout -b upgrade/nestjs-v11`

### Packages to Update (all together)

```json
{
  "@nestjs/common": "^11.1.13",
  "@nestjs/core": "^11.1.13",
  "@nestjs/platform-express": "^11.1.13",
  "@nestjs/platform-socket.io": "^11.1.13",
  "@nestjs/websockets": "^11.1.13",
  "@nestjs/config": "^4.0.3",
  "@nestjs/event-emitter": "^3.0.1",
  "@nestjs/jwt": "^11.0.2",
  "@nestjs/passport": "^11.0.5",
  "@nestjs/swagger": "^11.2.6",
  "@nestjs/testing": "^11.1.13",
  "@nestjs/cli": "^11.0.16",
  "@nestjs/schematics": "^11.0.9",
  "@nestjs/throttler": "^6.5.0"
}
```

### Expected Breaking Changes (to verify)

#### @nestjs/config v4

- Possible changes in schema validation
- Verify `ConfigModule.forRoot()` configuration

#### @nestjs/swagger v11

- Major jump from v7 → v11
- Verify OpenAPI decorators
- Check `DocumentBuilder` API

#### @nestjs/event-emitter v3

- Verify listener syntax
- Check event types

### NestJS v11 Test Plan

```bash
# 1. Update package.json (manually or with script)
# 2. Install
npm install

# 3. Rebuild
npm run build

# 4. Fix TypeScript errors
# ...

# 5. Unit tests
npm run test:unit

# 6. Integration tests
npm run test:integration

# 7. E2E tests
npm run test:e2e

# 8. Manual local testing
npm run start:dev

# 9. Verify:
# - Auth0 JWT authentication
# - WebSocket connections
# - Stripe webhooks
# - Swagger docs (/docs)
# - Throttling
# - Real-time notifications
```

### Rollback Plan

```bash
git checkout main
git branch -D upgrade/nestjs-v11
npm install
```

---

## Step 3: Prisma v5 → v7 Upgrade

### SIGNIFICANT BREAKING CHANGES

Prisma v7 is a major update with substantial changes:

- New Query Engine
- Changed type generation
- Possible modifications to schema helpers

### Required Preparation

#### 1. Database Backup

```bash
# Dump current database
pg_dump DATABASE_URL > backup_before_prisma7.sql
```

#### 2. Review Migration Guide

- [ ] Read [Prisma v7 Upgrade Guide](https://www.prisma.io/docs/guides/upgrade-guides/upgrading-versions/upgrading-to-prisma-7)
- [ ] Verify schema changes
- [ ] Check breaking changes in generated types

#### 3. Test on Development Database

- [ ] Create test database
- [ ] Apply migration on test DB
- [ ] Verify generated client

### Packages to Update

```json
{
  "@prisma/client": "^7.4.0",
  "prisma": "^7.4.0"
}
```

### Prisma Upgrade Plan

```bash
# 1. Update package.json
# 2. Install
npm install

# 3. Regenerate Prisma Client
npx prisma generate

# 4. Verify schema
npx prisma validate

# 5. Test migration (dry run)
npx prisma migrate dev --create-only

# 6. Apply migration
npx prisma migrate dev

# 7. Test
npm run test:unit
npm run test:integration
```

### Critical Post-Upgrade Tests

- [ ] CRUD operations (Organization, Team, Player)
- [ ] Relations (memberships, subscriptions)
- [ ] Transactions
- [ ] Audit log queries
- [ ] Notifications queries

---

## Step 4: Sentry v7 → v10 Upgrade

### Sentry v10 Breaking Changes

Sentry v10 has significant API changes:

- Changed `Sentry.init()` configuration
- New method names for tracing
- Different transport configuration

### Files to Modify

```
src/observability/sentry/
├── sentry-init.service.ts    REQUIRES MODIFICATIONS
├── sentry.filter.ts          VERIFY API
├── sentry.interceptor.ts     VERIFY TRACING
└── sentry.logger.ts          VERIFY CAPTURE METHODS
```

### Packages to Update

```json
{
  "@sentry/node": "^10.38.0",
  "@sentry/profiling-node": "^10.38.0"
}
```

### Sentry Upgrade Plan

```bash
# 1. Read migration guide
# https://docs.sentry.io/platforms/node/migration/

# 2. Update package.json
# 3. npm install

# 4. Update sentry-init.service.ts
# - Verify Sentry.init() options
# - Update integrations
# - Verify profiling setup

# 5. Test
# - npm run test:unit -- observability
# - Test in staging with SENTRY_DSN configured
# - Verify events on Sentry dashboard
```

### Post-Upgrade Tests

- [ ] Exception capture working
- [ ] Performance tracing active
- [ ] User context correct
- [ ] Request context propagation
- [ ] Breadcrumbs logging

---

## Step 5: Stripe v14 → v20 Upgrade

### Stripe v20 Breaking Changes

Major version jump with possible breaking changes:

- Renamed API methods
- Changed event structure
- Webhook signature verification

### Files to Verify

```
src/modules/billing/
├── billing.service.ts        VERIFY STRIPE API
├── billing.controller.ts     WEBHOOK HANDLING
└── ...
```

### Packages to Update

```json
{
  "stripe": "^20.3.1"
}
```

### Stripe Upgrade Plan

```bash
# 1. Read changelog
# https://github.com/stripe/stripe-node/blob/master/CHANGELOG.md

# 2. Test in Stripe test mode
# 3. Verify webhook signature
# 4. Test subscription creation
# 5. Test complete payment flow
```

---

## Step 6: ESLint Flat Config + TypeScript-ESLint v8

### REQUIRES CONFIGURATION REWRITE

ESLint v10 requires new "flat config" format:

- `.eslintrc.js` becomes `eslint.config.js`
- New configuration format
- Possibly deprecated rules

### Packages to Update

```json
{
  "eslint": "^10.0.0",
  "@typescript-eslint/eslint-plugin": "^8.55.0",
  "@typescript-eslint/parser": "^8.55.0",
  "eslint-config-prettier": "^10.1.8"
}
```

### Plan

1. Create new format `eslint.config.js`
2. Migrate rules from `.eslintrc.js`
3. Test: `npm run lint:check`
4. Automatic fixes: `npm run lint`

---

## Step 7: Jest v30 + Testing

### Packages to Update

```json
{
  "jest": "^30.2.0",
  "@types/jest": "^30.0.0",
  "ts-jest": "^29.1.1",
  "supertest": "^7.2.2"
}
```

### Post-Upgrade Tests

- [ ] npm run test:unit
- [ ] npm run test:integration
- [ ] npm run test:e2e
- [ ] npm run test:cov

---

## Step 8: Other Minor Updates

```json
{
  "@types/node": "^20.19.33",
  "@types/express": "^4.17.25",
  "socket.io-client": "^4.8.3"
}
```

---

## Recommended Execution Order

1. **Safe Patch/Minor** (DONE)
2. **NestJS v11** (next)
3. **Prisma v7** (after NestJS stable)
4. **Sentry v10** (requires updated observability code)
5. **Stripe v20** (intensive payment flow testing)
6. **ESLint v10** (doesn't block application)
7. **Jest v30** (last, testing only)

---

## Checklist Before Each Step

- [ ] Git commit current state
- [ ] Create dedicated branch
- [ ] Read official migration guide
- [ ] Local backup if necessary
- [ ] Test on development environment
- [ ] Clear rollback plan

---

## Support

For each step:

1. Ask for confirmation before proceeding
2. Test thoroughly
3. Verify critical functionality
4. Rollback if necessary

---

**Last update**: February 13, 2026  
**Next step**: NestJS v11 upgrade
