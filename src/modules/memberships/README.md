# Memberships Module

Manages user-organization relationships with roles and permissions.

## Features

- User-organization relationships
- Role assignment (OWNER, ADMIN, MEMBER, COACH)
- Membership invitation system
- RBAC integration

## Database Schema

Table `memberships`:
- `id`, `userId`, `orgId`
- `role` (OWNER | ADMIN | MEMBER | COACH)
- `createdAt`, `updatedAt`

## Role Hierarchy

| Role | Description | Permissions |
|------|-------------|-------------|
| OWNER | Organization owner | Full access (manage) |
| ADMIN | Administrator | Manage features, users |
| MEMBER | Standard member | Read + basic operations |
| COACH | Team coach | Team management, file upload |

## Usage

```typescript
// Check user membership
const membership = await this.membershipsService.findByUserAndOrg(
  userId, 
  orgId
);

// Check user role
const isAdmin = membership.role === Role.ADMIN || membership.role === Role.OWNER;
```

## Documentation

For RBAC integration see:
- [docs/13-RBAC_SETUP.md](../../../docs/13-RBAC_SETUP.md) - Complete RBAC system
- [docs/18-RBAC_USAGE_GUIDE.md](../../../docs/18-RBAC_USAGE_GUIDE.md) - RBAC usage guide
