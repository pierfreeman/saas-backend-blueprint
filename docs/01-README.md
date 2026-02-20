# Multi-tenant SaaS Backend Blueprint

Production-ready backend built with NestJS, featuring multi-tenancy, RBAC, billing, and enterprise capabilities.

## Tech Stack

- **Framework**: NestJS (TypeScript)
- **Database**: PostgreSQL + Prisma ORM
- **Cache**: Redis
- **Authentication**: Auth0 (JWT RS256 + JWKS)
- **Billing**: Stripe
- **Event System**: EventEmitter2

## Features

- 🏢 Multi-tenancy with organization isolation
- 🔐 JWT authentication with Auth0
- 👥 Role-based access control (RBAC)
- 💳 Stripe billing integration
- 🚀 Feature gating based on subscription
- 📋 Audit logging
- 🛡️ Production-ready security
- 🐳 Docker support

## Getting Started

### 🚀 Quick Setup (10 minutes)

Follow these guides to get up and running:

1. **[03-QUICK_START_AUTH0.md](./03-QUICK_START_AUTH0.md)** - Setup authentication (5 min)
2. **[04-QUICK_START_STRIPE.md](./04-QUICK_START_STRIPE.md)** - Setup billing (5 min)

### 📚 Complete Setup Guides

For production and advanced configuration:

- **[00-INDEX.md](./00-INDEX.md)** - Complete setup documentation index
- **[05-AUTH0_SETUP.md](./05-AUTH0_SETUP.md)** - Full Auth0 configuration guide
- **[06-STRIPE_SETUP.md](./06-STRIPE_SETUP.md)** - Full Stripe configuration guide
- **[27-SECURITY_MIDDLEWARE_LAYER.md](./27-SECURITY_MIDDLEWARE_LAYER.md)** - Security middleware and OWASP-aligned protections

### Prerequisites

- Node.js 20+
- PostgreSQL 16+
- Redis 7+
- Auth0 account (free tier works)
- Stripe account (test mode)
- Docker (optional)

### Installation

```bash
npm install
```

### Environment Setup

Copy `.env.example` to `.env` and configure:

```bash
cp .env.example .env
```

### Database Setup

```bash
npm run prisma:generate
npm run prisma:migrate
```

### Running the Application

Development:

```bash
npm run start:dev
```

Production:

```bash
npm run build
npm run start:prod
```

With Docker:

```bash
docker-compose up
```

## Project Structure

```
src/
├── common/           # Shared utilities, filters, interceptors
├── config/           # Configuration modules
├── prisma/           # Prisma service
├── redis/            # Redis service
├── events/           # Event bus
├── auth/             # Authentication
├── organizations/    # Organization management
├── memberships/      # User-organization relationships
├── teams/            # Teams module
├── players/          # Players module
├── billing/          # Stripe integration
├── subscriptions/    # Subscription management
├── feature-flags/    # Feature gating
├── audit/            # Audit logging
├── notifications/    # 🔔 Real-time notifications (NEW)
└── admin/            # Admin control plane
```

## 🔔 Real-time Notifications

Production-ready real-time notification system using WebSocket (Socket.IO) + Redis Pub/Sub.

**Features:**

- ✅ Real-time delivery via WebSocket
- ✅ Persistent storage (Postgres)
- ✅ Redis Pub/Sub for horizontal scaling
- ✅ JWT authentication on WebSocket
- ✅ REST API + WebSocket events
- ✅ Full test coverage

**Quick Links:**

- 📘 [Complete Setup Guide](./07-NOTIFICATIONS_SETUP.md) - Architecture, API, testing
- 💡 [Use Cases & Examples](./09-USE_CASES.md) - 8 real-world scenarios
- ⚛️ [React Hook Example](./10-client-example-react.example.tsx)
- 🅰️ [Angular Service Example](./11-client-example-angular.example.ts)

## 🔒 API Security Layer

The backend includes a dedicated security middleware layer for common API threat mitigation.

**Includes:**

- ✅ Redis-backed rate limiting
- ✅ Brute-force protection on auth routes
- ✅ Payload sanitization (XSS + SQL/NoSQL threat patterns)
- ✅ CSRF checks for cookie-based stateful flows
- ✅ Secure headers + request size limits
- ✅ Security incident events for audit trail

See [27-SECURITY_MIDDLEWARE_LAYER.md](./27-SECURITY_MIDDLEWARE_LAYER.md) for architecture, env variables, and test coverage details.

**Quick Start:**

```bash
# Run security middleware tests
npm test -- --runInBand \
  test/security/attack-detection.service.spec.ts \
  test/security/payload-sanitization.middleware.spec.ts \
  test/security/security-layer.integration.spec.ts
```

Use [07-NOTIFICATIONS_SETUP.md](./07-NOTIFICATIONS_SETUP.md) for WebSocket setup and [27-SECURITY_MIDDLEWARE_LAYER.md](./27-SECURITY_MIDDLEWARE_LAYER.md) for API security operations.

## API Documentation

Available at `/docs` when running in development mode.

## 🎯 User Flow

1. **Sign Up:** User creates account via Auth0
2. **Auto-Setup:** Backend automatically creates:
   - User record in database
   - Personal organization
   - FREE subscription
   - Owner membership
3. **Use App:** User can immediately use the application
4. **Upgrade:** User can upgrade to PRO/ENTERPRISE via Stripe Checkout
5. **Team Collaboration:** User can invite members to organization

## Testing

```bash
# unit tests
npm run test

# e2e tests
npm run test:e2e

# test coverage
npm run test:cov
```

## License

UNLICENSED
