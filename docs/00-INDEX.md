# Documentation Index

Multi-tenant SaaS Backend Blueprint - Complete setup and reference documentation.

## How to Use This Documentation

Files are organized sequentially from basic setup to advanced configurations:

1. **[01-README.md](./01-README.md)** - Project overview and tech stack
2. **[02-SETUP_CHECKLIST.md](./02-SETUP_CHECKLIST.md)** - Complete setup checklist
3. **[03-QUICK_START_AUTH0.md](./03-QUICK_START_AUTH0.md)** - Auth0 quick setup (5 min)
4. **[04-QUICK_START_STRIPE.md](./04-QUICK_START_STRIPE.md)** - Stripe quick setup (5 min)
5. **[05-AUTH0_SETUP.md](./05-AUTH0_SETUP.md)** - Complete Auth0 configuration
6. **[06-STRIPE_SETUP.md](./06-STRIPE_SETUP.md)** - Complete Stripe configuration
7. **[07-NOTIFICATIONS_SETUP.md](./07-NOTIFICATIONS_SETUP.md)** - Real-time notifications system
8. **[08-CODE_QUALITY.md](./08-CODE_QUALITY.md)** - Linting, formatting, best practices
9. **[09-USE_CASES.md](./09-USE_CASES.md)** - Practical examples and use cases
10. **[10-client-example-react.example.tsx](./10-client-example-react.example.tsx)** - React client example
11. **[11-client-example-angular.example.ts](./11-client-example-angular.example.ts)** - Angular client example
12. **[12-OBSERVABILITY_SETUP_COMPLETE.md](./12-OBSERVABILITY_SETUP_COMPLETE.md)** - Observability and monitoring setup
13. **[13-RBAC_SETUP.md](./13-RBAC_SETUP.md)** - Complete RBAC system
14. **[14-RBAC_MIGRATION_GUIDE.md](./14-RBAC_MIGRATION_GUIDE.md)** - RBAC migration guide
15. **[15-RBAC_IMPLEMENTATION.md](./15-RBAC_IMPLEMENTATION.md)** - RBAC implementation summary
16. **[16-RBAC_FILES_CHANGED.md](./16-RBAC_FILES_CHANGED.md)** - RBAC files changed
17. **[17-RBAC_CODE_EXAMPLES.ts](./17-RBAC_CODE_EXAMPLES.ts)** - RBAC code examples
18. **[18-RBAC_USAGE_GUIDE.md](./18-RBAC_USAGE_GUIDE.md)** - RBAC developer guide
19. **[19-RBAC_MIGRATION_CHECKLIST.md](./19-RBAC_MIGRATION_CHECKLIST.md)** - RBAC migration checklist
20. **[20-RBAC_MIGRATION_SUMMARY.md](./20-RBAC_MIGRATION_SUMMARY.md)** - RBAC migration complete report
21. **[21-STORAGE_SETUP.md](./21-STORAGE_SETUP.md)** - Complete storage layer (S3/Azure)
22. **[22-STORAGE_QUICK_START.md](./22-STORAGE_QUICK_START.md)** - Storage quick start (5 min)
23. **[23-STORAGE_IMPLEMENTATION.md](./23-STORAGE_IMPLEMENTATION.md)** - Storage implementation summary
24. **[24-STORAGE_USAGE_GUIDE.md](./24-STORAGE_USAGE_GUIDE.md)** - Storage API usage guide
25. **[25-NOTIFICATIONS_IMPLEMENTATION.md](./25-NOTIFICATIONS_IMPLEMENTATION.md)** - Notifications implementation summary
26. **[26-UPGRADE_PLAN.md](./26-UPGRADE_PLAN.md)** - Dependencies upgrade plan
27. **[27-SECURITY_MIDDLEWARE_LAYER.md](./27-SECURITY_MIDDLEWARE_LAYER.md)** - OWASP-aligned API security middleware layer

**Latest Updates:**

- 2026-02-19: Security Middleware Layer - Rate limiting, brute-force protection, sanitization, CSRF, secure headers, audit events
- 2026-02-14: Storage Module - Multi-provider (S3/Azure), multipart upload 100GB+, quota management
- 2026-02-13: RBAC Migration - All controllers migrated with 50+ E2E tests

---

## Quick Start

To get started quickly:

1. **[03-QUICK_START_AUTH0.md](./03-QUICK_START_AUTH0.md)** - Auth0 setup (5 min)
2. **[04-QUICK_START_STRIPE.md](./04-QUICK_START_STRIPE.md)** - Stripe setup (5 min)

After completing both, your backend will support:

- User authentication
- Automatic FREE org creation
- Subscription upgrade to PRO/ENTERPRISE

---

## Complete Guides

For advanced configuration and production deployment:

### Authentication

- **[05-AUTH0_SETUP.md](./05-AUTH0_SETUP.md)** - Complete Auth0 guide
  - Single Page Application setup
  - API configuration & RBAC
  - Custom claims with Actions
  - MFA & Social Connections
  - Production deployment
  - Security best practices

### Billing

- **[06-STRIPE_SETUP.md](./06-STRIPE_SETUP.md)** - Complete Stripe guide
  - Products and pricing
  - Webhook configuration
  - Testing with Stripe CLI
  - Complete checkout flow
  - Production deployment
  - Test cards

### RBAC & Authorization

- **[13-RBAC_SETUP.md](./13-RBAC_SETUP.md)** - Enterprise-ready RBAC system
  - Permission-based access control
  - Multi-tenant org-scoped RBAC
  - Redis caching & auto-invalidation
  - Guards & decorators
  - Testing & best practices
- **[14-RBAC_MIGRATION_GUIDE.md](./14-RBAC_MIGRATION_GUIDE.md)** - Migration from legacy guards
  - Old vs new system comparison
  - Step-by-step migration
  - Breaking changes
  - Quick reference
- **[15-RBAC_IMPLEMENTATION.md](./15-RBAC_IMPLEMENTATION.md)** - Implementation summary
- **[16-RBAC_FILES_CHANGED.md](./16-RBAC_FILES_CHANGED.md)** - Modified files
- **[17-RBAC_CODE_EXAMPLES.ts](./17-RBAC_CODE_EXAMPLES.ts)** - 12 practical examples
- **[18-RBAC_USAGE_GUIDE.md](./18-RBAC_USAGE_GUIDE.md)** - Complete developer guide
  - Quick start with examples
  - Complete permission matrix
  - Common usage patterns
  - Available decorators
  - Best practices & FAQ
- **[19-RBAC_MIGRATION_CHECKLIST.md](./19-RBAC_MIGRATION_CHECKLIST.md)** - Controller migration checklist
  - Migrated controllers status (6/6)
  - Documented breaking changes
  - Endpoint permission matrix
  - Deprecated guards to remove
- **[20-RBAC_MIGRATION_SUMMARY.md](./20-RBAC_MIGRATION_SUMMARY.md)** - Complete migration report
  - All implemented changes
  - Complete E2E tests (50+ tests)
  - Security features
  - Metrics & status
- **[rbac-commands.sh](./rbac-commands.sh)** - Quick commands script

### �️ Storage Layer (File Uploads)

- **[21-STORAGE_SETUP.md](./21-STORAGE_SETUP.md)** - Storage enterprise-ready completo
  - Multi-provider support (AWS S3 / Azure Blob)
  - Direct upload via presigned URLs
  - Multipart upload for files up to 100GB+
  - Database persistence with complete metadata
  - Plan-based quota management
  - RBAC integration & audit logging
  - Automatic cleanup with cron jobs
  - Provider configuration (S3/Azure)
- **[22-STORAGE_QUICK_START.md](./22-STORAGE_QUICK_START.md)** - Storage quick start (5 min)
  - Automated setup with script
  - Minimal environment variables
  - Endpoint-by-endpoint API testing
  - Common troubleshooting
- **[23-STORAGE_IMPLEMENTATION.md](./23-STORAGE_IMPLEMENTATION.md)** - Implementation summary
  - All deliverables completed
  - File structure (40+ files)
  - Detailed database schema
  - Success criteria validation
  - Dependencies & deployment steps
- **[24-STORAGE_USAGE_GUIDE.md](./24-STORAGE_USAGE_GUIDE.md)** - Storage API developer guide
  - Complete upload flow with React examples
  - Download, list, delete operations
  - Error handling & retry logic
  - Resume upload after failure
  - Best practices & UI components

### Real-Time Notifications

- **[07-NOTIFICATIONS_SETUP.md](./07-NOTIFICATIONS_SETUP.md)** - Notifications system
  - WebSocket gateway (Socket.IO)
  - Redis Pub/Sub for scalability
  - JWT auth on WebSocket handshake
  - Frontend examples (React/Angular)
- **[25-NOTIFICATIONS_IMPLEMENTATION.md](./25-NOTIFICATIONS_IMPLEMENTATION.md)** - Implementation summary
  - Implemented components
  - Database schema
  - Test coverage (unit + e2e)
  - Complete client examples

### Observability

- **[12-OBSERVABILITY_SETUP_COMPLETE.md](./12-OBSERVABILITY_SETUP_COMPLETE.md)** - Monitoring & logging
  - Datadog integration
  - Sentry error tracking
  - Custom metrics

### API Security

- **[27-SECURITY_MIDDLEWARE_LAYER.md](./27-SECURITY_MIDDLEWARE_LAYER.md)** - Security middleware layer
  - Redis-backed rate limiting and anti-brute-force controls
  - SQL/NoSQL injection and XSS payload mitigation
  - CSRF checks for stateful routes
  - Secure headers and request size limits
  - Global security incident handling and audit events

---

## Database

### Prisma Migrations

```bash
# Generate Prisma Client
npm run prisma:generate

# Create new migration
npm run prisma:migrate

# Reset database (WARNING!)
npx prisma migrate reset

# Prisma Studio (Database GUI)
npm run prisma:studio
```

### Schema Overview

Main database tables:

- `users` - Authenticated users (synced from Auth0)
- `organizations` - Organizations/tenants
- `memberships` - User ↔ organization relationships (with roles)
- `subscriptions` - Subscription plans and status (FREE/PRO/ENTERPRISE)
- `teams` - Teams within organizations
- `players` - Players within teams
- `audit_events` - Audit trail of actions

---

## Environment Variables

### Backend (.env)

```bash
# Application
NODE_ENV=development
PORT=3000

# Database
DATABASE_URL="postgresql://user:password@localhost:5432/sports_intelligence?schema=public"

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=

# Auth0
AUTH0_DOMAIN=your-tenant.auth0.com
AUTH0_AUDIENCE=https://api.sports-intelligence.com

# Stripe
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_ID_PRO=price_...
STRIPE_PRICE_ID_ENTERPRISE=price_...

# Frontend
FRONTEND_URL=http://localhost:4200

# Feature Flags
FEATURE_FLAGS_CACHE_TTL=600

# Admin
SUPER_ADMIN_EMAILS=admin@example.com

# Rate Limiting
THROTTLE_TTL=60
THROTTLE_LIMIT=100
RATE_LIMIT_REQUESTS=100
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_BURST=20

# Security Middleware Layer
BRUTE_FORCE_MAX_ATTEMPTS=5
BRUTE_FORCE_BLOCK_MS=900000
MAX_BODY_SIZE=2MB
SECURITY_HEADERS_ENABLED=true
CSRF_PROTECTION_ENABLED=true
SECURITY_AUTO_THROTTLE_ENABLED=true
SUSPICIOUS_SCORE_THRESHOLD=20
```

### Frontend (environment.ts)

```typescript
export const environment = {
  production: false,
  apiUrl: 'http://localhost:3000',
  auth0: {
    domain: 'your-tenant.auth0.com',
    clientId: 'YOUR_CLIENT_ID',
    audience: 'https://api.sports-intelligence.com',
    redirectUri: 'http://localhost:4200/auth/callback',
  },
  stripe: {
    priceIdPro: 'price_...',
    priceIdEnterprise: 'price_...',
  },
};
```

---

## Testing

### Unit Tests

```bash
npm run test
npm run test:watch
npm run test:cov
```

### Integration Tests

```bash
npm run test:integration
```

### E2E Tests

```bash
npm run test:e2e
```

---

## Running the Application

### Development

```bash
# Backend with hot-reload
npm run start:dev

# Frontend
cd ../sports-intelligence-frontend
npm start
```

### Production

```bash
# Build
npm run build

# Run
npm run start:prod
```

---

## Architecture Overview

### Backend Stack

- **Framework:** NestJS (Node.js)
- **Database:** PostgreSQL with Prisma ORM
- **Cache:** Redis
- **Auth:** Auth0 (JWT)
- **Payments:** Stripe
- **API Docs:** Swagger/OpenAPI

### Key Features

- Multi-tenancy with organizations
- Role-based access control (RBAC)
- Subscription management (FREE/PRO/ENTERPRISE)
- Analytics & audit trail
- Secure JWT authentication
- Redis caching
- Comprehensive logging
- Rate limiting
- Feature flags

---

## Deployment

### Prerequisites

- Node.js 18+
- PostgreSQL 14+
- Redis 6+
- Auth0 account
- Stripe account

### Steps

1. Clone repository
2. Install dependencies: `npm install`
3. Setup Auth0 (follow 03-QUICK_START_AUTH0.md)
4. Setup Stripe (follow 04-QUICK_START_STRIPE.md)
5. Configure .env file
6. Run migrations: `npm run prisma:migrate`
7. Start application: `npm run start:dev`

### Production Deployment

See detailed guides:

- [05-AUTH0_SETUP.md](./05-AUTH0_SETUP.md) - Step 8
- [06-STRIPE_SETUP.md](./06-STRIPE_SETUP.md) - Deploy in Production

---

## Troubleshooting

### Common Issues

**Database connection fails:**

```bash
# Check PostgreSQL is running
psql -h localhost -U postgres -d sports_intelligence

# Verify DATABASE_URL in .env
```

**Auth0 token validation fails:**

```bash
# Verify AUTH0_DOMAIN and AUTH0_AUDIENCE match exactly
# Check application is configured correctly in Auth0 Dashboard
```

**Stripe webhook fails:**

```bash
# Use Stripe CLI for local testing
stripe listen --forward-to localhost:3000/billing/webhook

# Verify STRIPE_WEBHOOK_SECRET is correct
```

**Prisma client errors:**

```bash
# Regenerate Prisma client
npm run prisma:generate
```

---

## Additional Resources

### Documentation

- [NestJS Documentation](https://docs.nestjs.com)
- [Prisma Documentation](https://www.prisma.io/docs)
- [Auth0 Documentation](https://auth0.com/docs)
- [Stripe Documentation](https://stripe.com/docs)

### API Documentation

Once the backend is running, visit:

- Swagger UI: http://localhost:3000/docs
- OpenAPI JSON: http://localhost:3000/docs-json

---

## Contributing

When contributing:

1. Follow existing code style (enforced by ESLint/Prettier)
2. Write tests for new features
3. Update documentation as needed
4. Run linting: `npm run lint`
5. Run tests: `npm run test`

---

## Support

For questions or issues:

1. Check [05-AUTH0_SETUP.md](./05-AUTH0_SETUP.md) troubleshooting
2. Check [06-STRIPE_SETUP.md](./06-STRIPE_SETUP.md) troubleshooting
3. Review NestJS/Prisma documentation
4. Open an issue in the repository

---

**Happy Coding!**
