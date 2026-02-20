# Auth Module

Authentication module with Auth0 integration, JWT validation, and user sync.

## Features

- Auth0 JWT validation
- User sync from Auth0 to database
- Organization auto-creation (FREE plan)
- Guards for route protection

## Guards

- `JwtAuthGuard` - Validates Auth0 JWT token
- `OrgContextGuard` - Extracts and validates `x-org-id` header

## Setup

```bash
# Required environment variables
AUTH0_DOMAIN=your-tenant.auth0.com
AUTH0_AUDIENCE=https://api.sports-intelligence.com
```

## Usage

```typescript
@UseGuards(JwtAuthGuard, OrgContextGuard)
@Get('profile')
async getProfile(@Req() req: RequestWithOrgContext) {
  // req.user contains Auth0 user data
  // req.orgId contains validated organization ID
}
```

## Documentation

For complete setup:
- [docs/03-QUICK_START_AUTH0.md](../../../docs/03-QUICK_START_AUTH0.md) - Quick start (5 min)
- [docs/05-AUTH0_SETUP.md](../../../docs/05-AUTH0_SETUP.md) - Complete Auth0 setup
