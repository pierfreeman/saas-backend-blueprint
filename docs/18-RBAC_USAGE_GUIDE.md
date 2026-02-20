# 📘 RBAC System Usage Guide

## 🎯 Overview

The RBAC (Role-Based Access Control) system allows you to control access to endpoints based on:
- **Roles**: OWNER, ADMIN, MEMBER, COACH, VIEWER, READ_ONLY
- **Permissions**: Granular permissions per resource (org, team, player, analytics)

---

## 🚀 Quick Start

### 1. Import Guards and Decorators

```typescript
import { UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { 
  OrgContextGuard, 
  RBACGuard,
  RequirePermissions,
  CurrentUserId,
  CurrentOrgId,
  PERMISSIONS 
} from '../rbac';
```

### 2. Apply Guards to Controller

**Standard Pattern: Controller with Org Context**

```typescript
@Controller('organizations/:orgId/teams')
@UseGuards(JwtAuthGuard, OrgContextGuard, RBACGuard)
export class TeamsController {
  // ... endpoints
}
```

**Important Order:**
1. `JwtAuthGuard` - Validates JWT and populates `request.user`
2. `OrgContextGuard` - Verifies membership and populates `request.orgId`
3. `RBACGuard` - Checks permissions/roles

### 3. Specify Permissions for Endpoint

```typescript
@Get()
@RequirePermissions([PERMISSIONS.TEAM_READ])
async findAll(@CurrentOrgId() orgId: string) {
  return this.teamsService.findAll(orgId);
}

@Post()
@RequirePermissions([PERMISSIONS.TEAM_CREATE])
async create(
  @CurrentOrgId() orgId: string,
  @CurrentUserId() userId: string,
  @Body() dto: CreateTeamDto,
) {
  return this.teamsService.create(orgId, userId, dto);
}

@Delete(':id')
@RequirePermissions([PERMISSIONS.TEAM_DELETE])
async delete(@Param('id') id: string) {
  return this.teamsService.delete(id);
}
```

---

## 📋 Available Permissions

### Organization Permissions
```typescript
PERMISSIONS.ORG_MANAGE                  // Manage org (name, slug, settings)
PERMISSIONS.ORG_BILLING_MANAGE          // Manage billing (OWNER only)
PERMISSIONS.ORG_MEMBERS_INVITE          // Invite new members
PERMISSIONS.ORG_MEMBERS_REMOVE          // Remove members
PERMISSIONS.ORG_MEMBERS_ROLE_UPDATE     // Change member roles
PERMISSIONS.ORG_READ                    // Read org info
```

### Team Permissions
```typescript
PERMISSIONS.TEAM_CREATE                 // Create teams
PERMISSIONS.TEAM_UPDATE                 // Modify teams
PERMISSIONS.TEAM_DELETE                 // Delete teams
PERMISSIONS.TEAM_READ                   // Read teams
```

### Player Permissions
```typescript
PERMISSIONS.PLAYER_CREATE               // Create players
PERMISSIONS.PLAYER_UPDATE               // Modify players
PERMISSIONS.PLAYER_DELETE               // Delete players
PERMISSIONS.PLAYER_READ                 // Read players
```

### Analytics Permissions
```typescript
PERMISSIONS.ANALYTICS_VIEW              // View analytics
PERMISSIONS.ANALYTICS_EXPORT            // Export analytics data
```

---

## 🎭 Roles and Permission Matrix

| Permission | OWNER | ADMIN | MEMBER | COACH | VIEWER | READ_ONLY |
|-----------|:-----:|:-----:|:------:|:-----:|:------:|:---------:|
| **Organization** |
| org.manage | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| org.billing.manage | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| org.members.invite | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| org.members.remove | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| org.members.role.update | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| org.read | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Teams** |
| team.create | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| team.update | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| team.delete | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| team.read | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Players** |
| player.create | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| player.update | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| player.delete | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| player.read | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Analytics** |
| analytics.view | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| analytics.export | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |

---

## 🔧 Common Patterns

### Pattern 1: Read-Only Endpoint
Everyone can read:
```typescript
@Get()
@RequirePermissions([PERMISSIONS.TEAM_READ])
async findAll() { ... }
```

### Pattern 2: Admin-Only Endpoint
Only admin/owner:
```typescript
@Delete(':id')
@RequirePermissions([PERMISSIONS.TEAM_DELETE])
async delete() { ... }
```

### Pattern 3: Billing (Owner-Only)
Only owner can manage billing:
```typescript
@Post('checkout')
@RequirePermissions([PERMISSIONS.ORG_BILLING_MANAGE])
async createCheckout() { ... }
```

### Pattern 4: Multiple Permissions (OR logic)
User must have AT LEAST ONE of the permissions:
```typescript
@Put(':id/archive')
@RequirePermissions([PERMISSIONS.PLAYER_UPDATE, PERMISSIONS.PLAYER_DELETE])
async archive() { ... }
```

### Pattern 5: Multiple Permissions (AND logic)
User must have ALL permissions:
```typescript
@Get('export')
@RequirePermissions(
  [PERMISSIONS.ANALYTICS_VIEW, PERMISSIONS.ANALYTICS_EXPORT],
  'ALL'  // ← AND mode
)
async exportData() { ... }
```

### Pattern 6: Direct Role Check
Use role instead of permission:
```typescript
import { RequireRole, ROLES } from '../rbac';

@Delete('members/:userId')
@RequireRole(ROLES.OWNER, ROLES.ADMIN)
async removeMember() { ... }
```

---

## 🔍 Available Decorators

### @RequirePermissions()
```typescript
// Single permission
@RequirePermissions([PERMISSIONS.TEAM_CREATE])

// Multiple permissions (ANY - default)
@RequirePermissions([PERMISSIONS.PLAYER_UPDATE, PERMISSIONS.PLAYER_DELETE])

// Multiple permissions (ALL)
@RequirePermissions(
  [PERMISSIONS.ANALYTICS_VIEW, PERMISSIONS.ANALYTICS_EXPORT],
  'ALL'
)
```

### @RequireRole()
```typescript
// Single role
@RequireRole(ROLES.OWNER)

// Multiple roles
@RequireRole(ROLES.OWNER, ROLES.ADMIN)
```

### @CurrentUserId()
```typescript
async create(@CurrentUserId() userId: string) {
  // userId is the database user ID (not auth0Id)
}
```

### @CurrentOrgId()
```typescript
async findAll(@CurrentOrgId() orgId: string) {
  // orgId is validated by OrgContextGuard
}
```

---

## 🛡️ Endpoints without Org Context

For endpoints that DON'T require org context (e.g., "list my orgs"):

```typescript
@Controller('organizations')
export class OrganizationsController {

  @Get()
  @UseGuards(JwtAuthGuard)  // ← Only JWT, no RBAC
  async findMine(@CurrentUser() user: RequestUser) {
    return this.orgsService.findByUserId(user.dbUserId);
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard, OrgContextGuard, RBACGuard)  // ← With RBAC
  @RequirePermissions([PERMISSIONS.ORG_READ])
  async findOne(@Param('id') id: string) {
    return this.orgsService.findById(id);
  }
}
```

---

## ⚡ Performance: Redis Caching

The RBAC system uses Redis to cache permissions:

**Cache Key Pattern:**
```
rbac:user:{userId}:org:{orgId}
```

**TTL:** 10 minuti (configurabile)

**Auto-Invalidation:**
- When a member's role changes
- When status changes (ACTIVE/SUSPENDED)
- When membership is deleted

**No configuration needed** - everything is automatic!

---

## 🧪 Testing RBAC

### E2E Tests
See: [`test/e2e/rbac.e2e.spec.ts`](../test/e2e/rbac.e2e.spec.ts)

```typescript
it('VIEWER can read but NOT create teams', async () => {
  // Can read
  await request(app.getHttpServer())
    .get(`/organizations/${orgId}/teams`)
    .set('Authorization', viewerToken)
    .expect(200);

  // Cannot create
  await request(app.getHttpServer())
    .post(`/organizations/${orgId}/teams`)
    .set('Authorization', viewerToken)
    .send({ name: 'Test' })
    .expect(403);  // ← Forbidden
});
```

### Unit Test Guards
See: [`src/modules/rbac/tests/`](../src/modules/rbac/tests/)

---

## 📊 Real-World Examples

### Complete Teams Controller
```typescript
import { Controller, Get, Post, Put, Delete, UseGuards, Body, Param } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { 
  OrgContextGuard, 
  RBACGuard, 
  RequirePermissions,
  CurrentUserId,
  CurrentOrgId,
  PERMISSIONS 
} from '../rbac';

@Controller('organizations/:orgId/teams')
@UseGuards(JwtAuthGuard, OrgContextGuard, RBACGuard)
export class TeamsController {
  constructor(private readonly teamsService: TeamsService) {}

  @Get()
  @RequirePermissions([PERMISSIONS.TEAM_READ])
  async findAll(@CurrentOrgId() orgId: string) {
    return this.teamsService.findAll(orgId);
  }

  @Post()
  @RequirePermissions([PERMISSIONS.TEAM_CREATE])
  async create(
    @CurrentOrgId() orgId: string,
    @CurrentUserId() userId: string,
    @Body() dto: CreateTeamDto,
  ) {
    return this.teamsService.create(orgId, userId, dto);
  }

  @Put(':id')
  @RequirePermissions([PERMISSIONS.TEAM_UPDATE])
  async update(
    @CurrentOrgId() orgId: string,
    @Param('id') id: string,
    @Body() dto: UpdateTeamDto,
  ) {
    return this.teamsService.update(id, orgId, dto);
  }

  @Delete(':id')
  @RequirePermissions([PERMISSIONS.TEAM_DELETE])
  async delete(
    @CurrentOrgId() orgId: string,
    @Param('id') id: string,
  ) {
    await this.teamsService.delete(id, orgId);
    return { message: 'Team deleted successfully' };
  }
}
```

---

## ❓ FAQ

### Q: What's the difference between @RequirePermissions and @RequireRole?

**A:** 
- `@RequirePermissions()` - Granular, verifies specific permissions (recommended)
- `@RequireRole()` - Coarser, verifies entire role

**Best Practice:** Use `@RequirePermissions()` for most cases.

### Q: Can I use both @RequirePermissions and @RequireRole?

**A:** Yes! RBACGuard checks both with OR logic:
```typescript
@Delete('critical-operation')
@RequirePermissions([PERMISSIONS.ADMIN_DELETE])
@RequireRole(ROLES.OWNER)
async criticalOp() {
  // Access granted if:
  // - Has permission 'admin.delete' OR
  // - Is OWNER
}
```

### Q: How do I test different roles in development?

**A:** Create test members with different roles:
```bash
npm run test:e2e -- rbac.e2e.spec.ts
```

### Q: Can I disable cache for debugging?

**A:** Yes, set TTL to 0 in `rbac-cache.service.ts`:
```typescript
private readonly CACHE_TTL = 0; // Disable cache
```

### Q: How do I add a new permission?

1. Add in `permissions.constants.ts`:
```typescript
export const PERMISSIONS = {
  // ... existing
  NEW_FEATURE_ACCESS: 'feature.access',
} as const;
```

2. Add in seed `prisma/seeds/rbac.seed.ts`:
```typescript
const permissions = [
  // ... existing
  { key: 'feature.access', name: 'Access New Feature', description: '...' },
];
```

3. Assign to roles in seed

4. Re-run seed:
```bash
npx ts-node prisma/seeds/rbac.seed.ts
```

---

## 🎓 Best Practices

### ✅ DO

1. **Always use OrgContextGuard before RBACGuard**
2. **Prefer @RequirePermissions over @RequireRole**
3. **Use descriptive permission names**
4. **Always test with different roles**
5. **Document custom permissions in README**

### ❌ DON'T

1. **Don't bypass guards in production**
2. **Don't hardcode roles in services**
3. **Don't modify permissions at runtime**
4. **Don't use @RequireRole for granular control**

---

## 🔗 Related Resources

- [RBAC Implementation Details](./15-RBAC_IMPLEMENTATION.md)
- [RBAC Code Examples](./17-RBAC_CODE_EXAMPLES.ts)
- [RBAC E2E Tests](../test/e2e/rbac.e2e.spec.ts)
- [Permission Matrix Seed](../prisma/seeds/rbac.seed.ts)

---

✅ **RBAC system production-ready!**
