# Migration Guide: From Old Guards to RBAC System

## Overview

This guide shows how to migrate from existing guards (`OrgScopeGuard`, `RolesGuard`) to the new unified RBAC system.

---

## ❌ BEFORE (Old System)

```typescript
import { Controller, Get, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { OrgScopeGuard } from '../../common/guards/org-scope.guard';
import { RolesGuard, Roles } from '../../common/guards/roles.guard';
import { MembershipRole } from '@prisma/client';
import { OrgId } from '../../common/decorators/org-id.decorator';

@Controller('organizations/:orgId/teams')
@UseGuards(JwtAuthGuard, OrgScopeGuard, RolesGuard)
export class TeamsController {

  @Get()
  @Roles(MembershipRole.OWNER, MembershipRole.ADMIN, MembershipRole.MEMBER)
  async findAll(@OrgId() orgId: string) {
    return this.teamsService.findAllByOrg(orgId);
  }

  @Post()
  @Roles(MembershipRole.OWNER, MembershipRole.ADMIN)
  async create(@OrgId() orgId: string, @Body() dto: CreateTeamDto) {
    return this.teamsService.createTeam(orgId, dto);
  }

  @Delete(':id')
  @Roles(MembershipRole.OWNER, MembershipRole.ADMIN)
  async delete(@OrgId() orgId: string, @Param('id') id: string) {
    await this.teamsService.deleteTeam(id, orgId);
    return { message: 'Team deleted' };
  }
}
```

### ❌ Issues with the old system:
- ❌ Based only on static roles
- ❌ No granular permission system
- ❌ No caching
- ❌ Hard to extend (no permission matrix)
- ❌ Duplicate guards throughout codebase

---

## ✅ AFTER (New RBAC System)

```typescript
import { Controller, Get, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { 
  OrgContextGuard, 
  RBACGuard, 
  RequirePermissions,
  RequireRole,
  CurrentOrgId,
  CurrentUserId,
  OrgScoped,
  PERMISSIONS,
  ROLES
} from '../rbac';

@Controller('organizations/:orgId/teams')
@UseGuards(JwtAuthGuard, OrgContextGuard, RBACGuard)
export class TeamsController {

  // ✅ Permission-based (granular control)
  @Get()
  @RequirePermissions([PERMISSIONS.TEAM_READ])
  async findAll(@CurrentOrgId() orgId: string) {
    return this.teamsService.findAllByOrg(orgId);
  }

  // ✅ Permission-based (more flexible than roles)
  @Post()
  @RequirePermissions([PERMISSIONS.TEAM_CREATE])
  async create(
    @CurrentOrgId() orgId: string,
    @CurrentUserId() userId: string,
    @Body() dto: CreateTeamDto,
  ) {
    return this.teamsService.createTeam(orgId, dto);
  }

  // ✅ Role-based (when appropriate)
  @Delete(':id')
  @RequireRole(ROLES.OWNER, ROLES.ADMIN)
  async delete(
    @CurrentOrgId() orgId: string,
    @Param('id') id: string,
  ) {
    await this.teamsService.deleteTeam(id, orgId);
    return { message: 'Team deleted' };
  }
}
```

### ✅ Benefits of the new system:
- ✅ **Permission-based access control** (granular)
- ✅ **Redis caching** (10min TTL, auto-invalidation)
- ✅ **DB-driven permission matrix** (modifiable without redeployment)
- ✅ **Audit logging ready** (events for tracking)
- ✅ **WebSocket invalidation** (real-time notifications)
- ✅ **Testable** (unit + integration tests)
- ✅ **Type-safe** (`PERMISSIONS` constants)

---

## 🔄 Migration Steps

### Step 1: Import RBAC Types

```typescript
// REMOVE old imports
- import { OrgScopeGuard } from '../../common/guards/org-scope.guard';
- import { RolesGuard, Roles } from '../../common/guards/roles.guard';
- import { OrgId } from '../../common/decorators/org-id.decorator';

// ADD new imports
+ import { 
+   OrgContextGuard, 
+   RBACGuard, 
+   RequirePermissions,
+   RequireRole,
+   CurrentOrgId,
+   CurrentUserId,
+   PERMISSIONS,
+   ROLES
+ } from '../rbac';
```

### Step 2: Replace Guards

```typescript
// BEFORE
- @UseGuards(JwtAuthGuard, OrgScopeGuard, RolesGuard)

// AFTER
+ @UseGuards(JwtAuthGuard, OrgContextGuard, RBACGuard)
```

### Step 3: Replace Decorators

```typescript
// BEFORE
- @Roles(MembershipRole.OWNER, MembershipRole.ADMIN)
- async create(@OrgId() orgId: string) { ... }

// AFTER (permission-based, preferred)
+ @RequirePermissions([PERMISSIONS.TEAM_CREATE])
+ async create(@CurrentOrgId() orgId: string) { ... }

// OR (role-based, for admin-only)
+ @RequireRole(ROLES.OWNER, ROLES.ADMIN)
+ async create(@CurrentOrgId() orgId: string) { ... }
```

### Step 4: Update Decorators

```typescript
// BEFORE
- @OrgId() orgId: string

// AFTER
+ @CurrentOrgId() orgId: string

// NEW: also get userId
+ @CurrentUserId() userId: string
```

---

## 📊 Permission Mapping

Map old roles to new permissions:

| Old Role Check | New Permission |
|---|---|
| `@Roles(OWNER, ADMIN, MEMBER)` + team GET | `@RequirePermissions([PERMISSIONS.TEAM_READ])` |
| `@Roles(OWNER, ADMIN)` + team POST | `@RequirePermissions([PERMISSIONS.TEAM_CREATE])` |
| `@Roles(OWNER, ADMIN)` + team PATCH | `@RequirePermissions([PERMISSIONS.TEAM_UPDATE])` |
| `@Roles(OWNER, ADMIN)` + team DELETE | `@RequirePermissions([PERMISSIONS.TEAM_DELETE])` |
| `@Roles(OWNER)` + billing | `@RequirePermissions([PERMISSIONS.ORG_BILLING_MANAGE])` |
| `@Roles(OWNER, ADMIN)` + members | `@RequirePermissions([PERMISSIONS.ORG_MEMBERS_INVITE])` |

---

## 🧪 Testing Migration

### Before Migration

```typescript
describe('TeamsController (OLD)', () => {
  it('should deny VIEWER role', async () => {
    // Login as VIEWER
    const token = await getToken('viewer@test.com');

    return request(app.getHttpServer())
      .post('/organizations/org-1/teams')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Test' })
      .expect(403); // RolesGuard denial
  });
});
```

### After Migration

```typescript
describe('TeamsController (RBAC)', () => {
  it('should deny user without TEAM_CREATE permission', async () => {
    // Login as READ_ONLY (no TEAM_CREATE permission)
    const token = await getToken('readonly@test.com');

    return request(app.getHttpServer())
      .post('/organizations/org-1/teams')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Test' })
      .expect(403); // RBACGuard denial
  });

  it('should allow MEMBER with TEAM_CREATE permission', async () => {
    // Login as MEMBER (has TEAM_CREATE)
    const token = await getToken('member@test.com');

    return request(app.getHttpServer())
      .post('/organizations/org-1/teams')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Test' })
      .expect(201); // ✅ Allowed
  });
});
```

---

## ⚠️ Breaking Changes

### 1. OrgScopeGuard → OrgContextGuard

**Main difference:**
- `OrgContextGuard` auto-creates user in database if it doesn't exist
- Injects `dbUserId` into request (in addition to `orgId`)
- Also checks `membership.status` (ACTIVE, INVITED, SUSPENDED)

**Migration:**
```typescript
// OLD behavior: throws if user not in DB
- OrgScopeGuard

// NEW behavior: auto-creates user + checks status
+ OrgContextGuard
```

### 2. @Roles → @RequirePermissions

**Difference:**
- `@Roles` checks only static role
- `@RequirePermissions` checks dynamic permissions from DB

**Prefer permissions when possible:**
```typescript
// ❌ Rigid
@Roles(ROLES.ADMIN)

// ✅ Flexible (you can change permissions without redeployment)
@RequirePermissions([PERMISSIONS.TEAM_UPDATE])
```

### 3. Membership Status Handling

**NEW:** The RBAC system automatically denies access if:
- `membership.status === 'INVITED'`
- `membership.status === 'SUSPENDED'`

The old `RolesGuard` didn't check status.

---

## 🚀 Rollout Strategy

### Phase 1: Add RBAC Module (Done)
✅ DB migration
✅ Seed RBAC data
✅ Import RBACModule

### Phase 2: Migrate Critical Endpoints
🔄 Teams endpoints
🔄 Players endpoints
🔄 Organizations endpoints
⬜ Billing endpoints
⬜ Admin endpoints

### Phase 3: Full Migration
⬜ Remove old guards (`OrgScopeGuard`, `RolesGuard`)
⬜ Update all controllers
⬜ Update E2E tests

### Phase 4: Deprecation
⬜ Mark old guards as `@deprecated`
⬜ Remove from codebase

---

## 📝 Controller Migration Checklist

- [ ] Import RBAC guards and decorators
- [ ] Replace `@UseGuards(JwtAuthGuard, OrgScopeGuard, RolesGuard)`
- [ ] Replace `@Roles()` with `@RequirePermissions()` or `@RequireRole()`
- [ ] Replace `@OrgId()` with `@CurrentOrgId()`
- [ ] Add `@CurrentUserId()` where user ID is needed
- [ ] Update tests to validate new permissions
- [ ] Verify cache invalidation on membership changes

---

## 🎯 Quick Reference

### Guards Order (Always Use This)
```typescript
@UseGuards(JwtAuthGuard, OrgContextGuard, RBACGuard)
```

### Common Patterns

**Read operations:**
```typescript
@Get()
@RequirePermissions([PERMISSIONS.RESOURCE_READ])
async findAll(@CurrentOrgId() orgId: string) { ... }
```

**Write operations:**
```typescript
@Post()
@RequirePermissions([PERMISSIONS.RESOURCE_CREATE])
async create(@CurrentOrgId() orgId: string, @Body() dto) { ... }
```

**Admin-only:**
```typescript
@Delete(':orgId')
@RequireRole(ROLES.OWNER)
async deleteOrg(@Param('orgId') orgId: string) { ... }
```

**Multiple permissions (ANY):**
```typescript
@Put(':id')
@RequirePermissions([PERMISSIONS.A, PERMISSIONS.B]) // User needs A OR B
async update() { ... }
```

**Multiple permissions (ALL):**
```typescript
@Put(':id/sensitive')
@RequirePermissions([PERMISSIONS.A, PERMISSIONS.B], 'ALL') // User needs A AND B
async sensitiveUpdate() { ... }
```

---

## 🆘 Need Help?

1. Check [13-RBAC_SETUP.md](./13-RBAC_SETUP.md) for full documentation
2. Check `/src/modules/rbac/tests/` for examples
3. Run seed: `npx ts-node prisma/seeds/rbac.seed.ts`
4. Check cache: `redis-cli keys "rbac:*"`

---

**Happy Migration! 🚀**
