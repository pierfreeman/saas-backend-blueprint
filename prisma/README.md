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

1. **[QUICK_START_AUTH0.md](./QUICK_START_AUTH0.md)** - Setup authentication (5 min)
2. **[QUICK_START_STRIPE.md](./QUICK_START_STRIPE.md)** - Setup billing (5 min)

### 📚 Complete Setup Guides

For production and advanced configuration:

- **[SETUP_INDEX.md](./SETUP_INDEX.md)** - Complete setup documentation index
- **[AUTH0_SETUP.md](./AUTH0_SETUP.md)** - Full Auth0 configuration guide
- **[STRIPE_SETUP.md](./STRIPE_SETUP.md)** - Full Stripe configuration guide

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

### Prisma Migration Conventions

- `prisma/migrations/` must contain only Prisma-managed migration folders (and `migration_lock.toml`).
- ad-hoc or manual SQL scripts must go in `prisma/sql/`.
- when squashing local migrations during setup, run a full reset after the new baseline migration:

```bash
npx prisma migrate reset --force
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
└── admin/            # Admin control plane
```

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
