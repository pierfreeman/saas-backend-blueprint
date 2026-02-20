# RBAC System - Enterprise Multi-Tenant Authorization

Sistema RBAC (Role-Based Access Control) completo per NestJS multi-tenant con caching Redis, audit logging e supporto WebSocket.

## 📋 Indice

- [Architettura](#architettura)
- [Quick Start](#quick-start)
- [Utilizzo nei Controller](#utilizzo-nei-controller)
- [Guards](#guards)
- [Decorators](#decorators)
- [Permissions Matrix](#permissions-matrix)
- [Ruoli](#ruoli)
- [Caching](#caching)
- [Eventi WebSocket](#eventi-websocket)
- [Testing](#testing)
- [Best Practices](#best-practices)

---

## 🏗️ Architettura

```
rbac/
├── constants/
│   ├── permissions.constants.ts    # Permission keys
│   └── roles.constants.ts          # Role definitions
├── decorators/
│   ├── require-permissions.decorator.ts
│   ├── require-role.decorator.ts
│   ├── org-scoped.decorator.ts
│   └── rbac-context.decorator.ts
├── guards/
│   ├── org-context.guard.ts        # Org membership validation
│   └── rbac.guard.ts               # Permission/role enforcement
├── services/
│   ├── rbac.service.ts             # Core RBAC logic
│   ├── rbac-cache.service.ts       # Redis caching
│   └── permission-resolver.service.ts
├── events/
│   └── rbac.events.ts              # WebSocket events
└── tests/                          # Unit tests
```

---

## 🚀 Quick Start

### 1. Esegui la migrazione database

```bash
npx prisma migrate dev
```

### 2. Esegui il seed RBAC

```bash
npx ts-node prisma/seeds/rbac.seed.ts
```

### 3. Importa RBACModule

```typescript
import { RBACModule } from './modules/rbac/rbac.module';

@Module({
  imports: [
    // ... altri moduli
    RBACModule,
  ],
})
export class AppModule {}
```

---

## 🎯 Utilizzo nei Controller

### Basic Example

```typescript
import { Controller, Get, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { 
  OrgContextGuard, 
  RBACGuard, 
  RequirePermissions,
  CurrentUserId,
  CurrentOrgId,
  PERMISSIONS 
} from '../rbac';

@Controller('teams')
@UseGuards(JwtAuthGuard, OrgContextGuard, RBACGuard)
export class TeamsController {
  
  // ✅ Richiede permesso team.read
  @Get(':orgId/teams')
  @RequirePermissions([PERMISSIONS.TEAM_READ])
  async getTeams(@CurrentOrgId() orgId: string) {
    return this.teamsService.findAll(orgId);
  }

  // ✅ Richiede permesso team.create
  @Post(':orgId/teams')
  @RequirePermissions([PERMISSIONS.TEAM_CREATE])
  async createTeam(
    @CurrentOrgId() orgId: string,
    @CurrentUserId() userId: string,
    @Body() dto: CreateTeamDto,
  ) {
    return this.teamsService.create(orgId, userId, dto);
  }

  // ✅ Richiede ALMENO UNO dei permessi (ANY mode, default)
  @Delete(':orgId/teams/:id')
  @RequirePermissions([PERMISSIONS.TEAM_DELETE, PERMISSIONS.ORG_MANAGE])
  async deleteTeam(@Param('id') id: string) {
    return this.teamsService.delete(id);
  }

  // ✅ Richiede TUTTI i permessi (ALL mode)
  @Put(':orgId/teams/:id/archive')
  @RequirePermissions(
    [PERMISSIONS.TEAM_UPDATE, PERMISSIONS.TEAM_DELETE],
    'ALL'
  )
  async archiveTeam(@Param('id') id: string) {
    return this.teamsService.archive(id);
  }
}
```

### Example with Role-Based Access

```typescript
import { RequireRole, ROLES } from '../rbac';

@Controller('admin')
@UseGuards(JwtAuthGuard, OrgContextGuard, RBACGuard)
export class AdminController {

  // ✅ Solo OWNER o ADMIN
  @Delete(':orgId/members/:userId')
  @RequireRole(ROLES.OWNER, ROLES.ADMIN)
  async removeMember(
    @Param('orgId') orgId: string,
    @Param('userId') userId: string,
  ) {
    return this.membersService.remove(orgId, userId);
  }

  // ✅ Solo OWNER
  @Post(':orgId/billing/upgrade')
  @RequireRole(ROLES.OWNER)
  async upgradePlan(@Param('orgId') orgId: string) {
    return this.billingService.upgrade(orgId);
  }
}
```

### Example with OrgScoped (Explicit)

```typescript
import { OrgScoped } from '../rbac';

@Controller('players')
export class PlayersController {

  // ✅ Rende obbligatorio il contesto org
  @Get(':orgId/players')
  @OrgScoped()
  @UseGuards(JwtAuthGuard, OrgContextGuard)
  async getPlayers(@CurrentOrgId() orgId: string) {
    return this.playersService.findAll(orgId);
  }
}
```

---

## 🛡️ Guards

### OrgContextGuard

**Responsabilità:**
- Estrae `orgId` da params, query, body o header `X-Org-Id`
- Risolve l'utente database da Auth0 JWT
- Valida membership attiva
- Inietta `orgId`, `dbUserId` e `membership` nella request

**Ordine di esecuzione:** Deve essere applicato DOPO `JwtAuthGuard`

```typescript
@UseGuards(JwtAuthGuard, OrgContextGuard)
```

### RBACGuard

**Responsabilità:**
- Legge metadata `@RequirePermissions()` e `@RequireRole()`
- Risolve permissions dell'utente (con cache Redis)
- Valida accesso basato su permissions O roles
- Inietta `rbacPermissions` e `rbacRole` nella request

**Ordine di esecuzione:** Deve essere applicato DOPO `OrgContextGuard`

```typescript
@UseGuards(JwtAuthGuard, OrgContextGuard, RBACGuard)
```

---

## 🎨 Decorators

### @RequirePermissions()

```typescript
@RequirePermissions(permissions: string[], mode?: 'ANY' | 'ALL')
```

- **permissions**: Array di permission keys
- **mode**: 
  - `'ANY'` (default): Utente deve avere ALMENO UNA delle permissions
  - `'ALL'`: User must have ALL permissions

**Esempi:**
```typescript
// Richiede team.create O team.update
@RequirePermissions([PERMISSIONS.TEAM_CREATE, PERMISSIONS.TEAM_UPDATE])

// Richiede team.update E team.delete insieme
@RequirePermissions([PERMISSIONS.TEAM_UPDATE, PERMISSIONS.TEAM_DELETE], 'ALL')
```

### @RequireRole()

```typescript
@RequireRole(...roles: MembershipRole[])
```

Richiede che l'utente abbia ALMENO UNO dei ruoli specificati.

**Example:**
```typescript
@RequireRole(ROLES.OWNER, ROLES.ADMIN)
```

### @OrgScoped()

Marca esplicitamente una route come richiedente contesto org. Lancia errore se `orgId` non presente.

```typescript
@OrgScoped()
@Get(':orgId/stats')
```

### @CurrentUserId()

Estrae database user ID dalla request (iniettato da `OrgContextGuard`).

```typescript
async createTeam(@CurrentUserId() userId: string) { ... }
```

### @CurrentOrgId()

Estrae organization ID dalla request.

```typescript
async getTeams(@CurrentOrgId() orgId: string) { ... }
```

### @RBACContext()

Estrae intero contesto RBAC dalla request.

```typescript
async getData(@RBACContext() context: { userId, orgId, role, permissions }) { ... }
```

---

## 🔑 Permissions Matrix

### Organization Permissions

| Permission Key | Description | Roles |
|---|---|---|
| `org.manage` | Manage organization settings | OWNER |
| `org.billing.manage` | Manage billing and subscription | OWNER |
| `org.members.invite` | Invite members | OWNER, ADMIN |
| `org.members.remove` | Remove members | OWNER, ADMIN |
| `org.members.role.update` | Update roles | OWNER, ADMIN |
| `org.read` | Read org details | All roles |

### Team Permissions

| Permission Key | Description | Roles |
|---|---|---|
| `team.create` | Create teams | OWNER, ADMIN, MEMBER |
| `team.update` | Update teams | OWNER, ADMIN, MEMBER |
| `team.delete` | Delete teams | OWNER, ADMIN |
| `team.read` | Read teams | All roles |

### Player Permissions

| Permission Key | Description | Roles |
|---|---|---|
| `player.create` | Create players | OWNER, ADMIN, MEMBER, COACH |
| `player.update` | Update players | OWNER, ADMIN, MEMBER, COACH |
| `player.delete` | Delete players | OWNER, ADMIN |
| `player.read` | Read players | All roles |

### Analytics Permissions

| Permission Key | Description | Roles |
|---|---|---|
| `analytics.view` | View analytics | All roles |
| `analytics.export` | Export data | OWNER, ADMIN |

---

## 👥 Roles

### OWNER
- **Description**: Organization owner
- **Permissions**: ALL (16)
- **Note**: Can manage billing, delete org

### ADMIN
- **Description**: Administrator
- **Permissions**: All except billing (14)
- **Note**: Can manage members and their roles

### MEMBER
- **Description**: Standard member
- **Permissions**: Basic operations (8)
- **Note**: Can create/modify teams and players

### COACH
- **Description**: Coach (alias of MEMBER with player focus)
- **Permissions**: Focus on player management (6)
- **Note**: Legacy role, similar to MEMBER

### VIEWER / READ_ONLY
- **Description**: Read-only access
- **Permissions**: Only read (4)
- **Note**: VIEWER is legacy alias of READ_ONLY

---

## 💾 Caching

The system uses Redis to cache user permissions for 10 minutes.

### Cache Key Pattern

```
rbac:user:{userId}:org:{orgId}
```

### Automatic Invalidation

The cache is automatically invalidated when:
- ✅ Role utente cambia
- ✅ Membership status cambia
- ✅ Membership viene eliminata
- ✅ Membership viene creata (per quel user-org)

### API Cache Manuale

```typescript
import { RBACCacheService } from './rbac';

constructor(private rbacCache: RBACCacheService) {}

// Invalidare user-org specifico
await this.rbacCache.invalidate(userId, orgId);

// Invalidare tutti org di un utente
await this.rbacCache.invalidateUser(userId);

// Invalidare tutti utenti di un org
await this.rbacCache.invalidateOrg(orgId);

// Clear completo
await this.rbacCache.clearAll();
```

---

## 📡 Eventi WebSocket

Il modulo RBAC emette eventi quando cambiano permissions/roles, per notificare client in real-time.

### RBAC Event Types

```typescript
enum RBACEventType {
  ROLE_CHANGED = 'rbac.role.changed',
  MEMBERSHIP_STATUS_CHANGED = 'rbac.membership.status.changed',
  PERMISSIONS_UPDATED = 'rbac.permissions.updated',
  CACHE_INVALIDATED = 'rbac.cache.invalidated',
}
```

### WebSocket Gateway Integration Example

```typescript
import { EventBusService } from '../events/event-bus.service';
import { RBACEventType } from '../rbac';

@WebSocketGateway()
export class NotificationsGateway {
  constructor(private eventBus: EventBusService) {
    this.eventBus.on('membership.updated', (event) => {
      // Notifica client che il loro ruolo è cambiato
      this.server.to(`user:${event.userId}`).emit(RBACEventType.ROLE_CHANGED, {
        orgId: event.organizationId,
        newRole: event.payload.newRole,
      });
    });
  }
}
```

---

## 🧪 Testing

### Unit Tests

Esegui i test:

```bash
npm test -- rbac
```

Tests disponibili:
- ✅ `rbac.service.spec.ts` - RBACService logic
- ✅ `rbac-cache.service.spec.ts` - Redis caching
- ✅ `org-context.guard.spec.ts` - Org context guard
- ✅ `rbac.guard.spec.ts` - Permission/role guard

### Integration Test Example

```typescript
describe('RBAC Integration (e2e)', () => {
  it('should deny access without permission', async () => {
    // Login as READ_ONLY user
    const token = await getToken('read-only@test.com');

    return request(app.getHttpServer())
      .post('/orgs/org-1/teams')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Test Team' })
      .expect(403);
  });

  it('should allow access with permission', async () => {
    // Login as ADMIN
    const token = await getToken('admin@test.com');

    return request(app.getHttpServer())
      .post('/orgs/org-1/teams')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Test Team' })
      .expect(201);
  });
});
```

---

## ✅ Best Practices

### 1️⃣ **Ordine Guards**

```typescript
// ✅ CORRETTO
@UseGuards(JwtAuthGuard, OrgContextGuard, RBACGuard)

// ❌ SBAGLIATO
@UseGuards(RBACGuard, OrgContextGuard, JwtAuthGuard)
```

### 2️⃣ **Preferire Permissions a Roles**

```typescript
// ✅ PREFERITO (più flessibile)
@RequirePermissions([PERMISSIONS.TEAM_CREATE])

// ⚠️ OK per casi admin-only
@RequireRole(ROLES.OWNER)
```

### 3️⃣ **Non Hardcodare Permessi**

```typescript
// ✅ CORRETTO
import { PERMISSIONS } from '../rbac';
@RequirePermissions([PERMISSIONS.TEAM_CREATE])

// ❌ SBAGLIATO
@RequirePermissions(['team.create']) // Typo-prone
```

### 4️⃣ **Cache Invalidation**

Se modifichi manualmente membership/roles, invalida cache:

```typescript
await this.membershipsService.updateMembership(id, { role: 'ADMIN' });
await this.rbacCache.invalidate(userId, orgId); // ✅ Auto fatto da MembershipsService
```

### 5️⃣ **Testing RBAC**

Testa sempre permessi nei test E2E:

```typescript
it('should deny team deletion for MEMBER role', async () => {
  // ... test
});

it('should allow team deletion for ADMIN role', async () => {
  // ... test
});
```

### 6️⃣ **Audit Logging**

Integra con AuditModule per loggare azioni sensibili:

```typescript
@RequirePermissions([PERMISSIONS.ORG_MEMBERS_REMOVE])
async removeMember(userId: string, orgId: string) {
  await this.membersService.remove(userId, orgId);
  
  // Log sensitive action
  await this.auditService.log({
    type: 'member.removed',
    userId,
    orgId,
    payload: { removedUserId: userId },
  });
}
```

---

## 🔧 Troubleshooting

### Permission Denied (403)

1. Verifica che l'utente abbia membership attiva:
```typescript
const membership = await prisma.membership.findUnique({
  where: { userId_orgId: { userId, orgId } }
});
console.log(membership); // status === 'ACTIVE' ?
```

2. Verifica permissions del ruolo:
```typescript
const permissions = await rbacService.getPermissionsForRole(membership.role);
console.log(permissions); // Contiene la permission richiesta?
```

3. Controlla cache Redis:
```typescript
const cached = await rbacCache.get(userId, orgId);
console.log(cached); // Cache valida?
```

### Cache Non Invalida

Se la cache non si invalida correttamente:

```typescript
// Force invalidation
await rbacCache.clearAll();

// Ricarica role permissions
await rbacService.refreshPermissionsCache();
```

---

## 📚 Risorse Aggiuntive

- **Prisma Schema**: `/prisma/schema.prisma`
- **Seed Script**: `/prisma/seeds/rbac.seed.ts`
- **Migration**: `/prisma/migrations/*/migration.sql`
- **Constants**: `/src/modules/rbac/constants/`

---

## 🎉 Conclusione

Il sistema RBAC è ora pronto per essere utilizzato. Applica i guards, usa i decorators e gestisci permissions in modo enterprise-grade!

Per domande o miglioramenti, consulta i test o apri una issue.

**Happy coding! 🚀**
