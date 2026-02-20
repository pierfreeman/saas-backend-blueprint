# RBAC Module

Enterprise-grade Role-Based Access Control system for NestJS multi-tenant SaaS.

## Quick Start

```typescript
import { 
  OrgContextGuard, 
  RBACGuard, 
  RequirePermissions,
  PERMISSIONS 
} from './rbac';

@Controller('teams')
@UseGuards(JwtAuthGuard, OrgContextGuard, RBACGuard)
export class TeamsController {
  @Get(':orgId/teams')
  @RequirePermissions([PERMISSIONS.TEAM_READ])
  async getTeams(@CurrentOrgId() orgId: string) {
    return this.teamsService.findAll(orgId);
  }
}
```

## Full Documentation

See:
- **Setup Guide**: `/docs/13-RBAC_SETUP.md`
- **Migration Guide**: `/docs/14-RBAC_MIGRATION_GUIDE.md`
- **Implementation Summary**: `/docs/15-RBAC_IMPLEMENTATION.md`
- **Files Changed**: `/docs/16-RBAC_FILES_CHANGED.md`
- **Code Examples**: `/docs/17-RBAC_CODE_EXAMPLES.ts`
- **Quick Commands**: `/docs/rbac-commands.sh`

## Testing

```bash
npm test -- --testPathPatterns=rbac
```

All 33 tests passing

## Features

- Permission-based access control
- Redis caching (10min TTL)
- DB-driven permission matrix
- Auto cache invalidation
- WebSocket events ready
- Multi-tenant org-scoped
- Zero breaking changes

## Permissions

16 permissions across 4 categories:
- **Org**: manage, billing, members
- **Team**: create, update, delete, read
- **Player**: create, update, delete, read
- **Analytics**: view, export

## Roles

6 roles with hierarchical permissions:
- **OWNER**: All permissions (16)
- **ADMIN**: All except billing (14)
- **MEMBER**: Standard operations (8)
- **COACH**: Player-focused (6)
- **VIEWER/READ_ONLY**: Read-only (4)

## Architecture

```
JwtAuthGuard → OrgContextGuard → RBACGuard → Controller
     ↓              ↓                ↓
  user.sub    user.dbUserId    rbacPermissions
              orgId            rbacRole
              membership
```

## 🎯 Best Practices

1. **Always use this guard order:**
   ```typescript
   @UseGuards(JwtAuthGuard, OrgContextGuard, RBACGuard)
   ```

2. **Prefer permissions over roles:**
   ```typescript
   // ✅ Flexible
   @RequirePermissions([PERMISSIONS.TEAM_CREATE])
   
   // ⚠️ Use only for admin-only endpoints
   @RequireRole(ROLES.OWNER)
   ```

3. **Use type-safe constants:**
   ```typescript
   // ✅ Type-safe
   import { PERMISSIONS } from './rbac';
   @RequirePermissions([PERMISSIONS.TEAM_CREATE])
   
   // ❌ Error-prone
   @RequirePermissions(['team.create'])
   ```

## 🔧 Troubleshooting

**Permission denied (403)?**
```typescript
// Check membership status
const membership = await prisma.membership.findUnique({
  where: { userId_orgId: { userId, orgId } }
});

// Check permissions for role
const permissions = await rbacService.getPermissionsForRole(role);

// Check cache
const cached = await rbacCache.get(userId, orgId);
```

**Cache not invalidating?**
```typescript
// Force invalidation
await rbacCache.invalidate(userId, orgId);
// or
await rbacCache.clearAll();
```

## 📚 Resources

- **Seed Script**: `/prisma/seeds/rbac.seed.ts`
- **Tests**: `/src/modules/rbac/tests/`
- **Constants**: `/src/modules/rbac/constants/`
- **Events**: `/src/modules/rbac/events/rbac.events.ts`

---

**Status**: ✅ Production Ready

Built with ❤️ for enterprise multi-tenant SaaS
