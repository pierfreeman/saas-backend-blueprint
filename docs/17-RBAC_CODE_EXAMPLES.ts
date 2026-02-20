/**
 * RBAC System - Code Examples
 * 
 * Ready-to-use code snippets for implementing RBAC in controllers
 */

// ============================================
// EXAMPLE 1: Basic Controller with RBAC
// ============================================

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

  // READ operation - most permissive
  @Get()
  @RequirePermissions([PERMISSIONS.TEAM_READ])
  async findAll(@CurrentOrgId() orgId: string) {
    return this.teamsService.findAll(orgId);
  }

  // CREATE operation - requires specific permission
  @Post()
  @RequirePermissions([PERMISSIONS.TEAM_CREATE])
  async create(
    @CurrentOrgId() orgId: string,
    @CurrentUserId() userId: string,
    @Body() dto: CreateTeamDto,
  ) {
    return this.teamsService.create(orgId, userId, dto);
  }

  // UPDATE operation
  @Put(':id')
  @RequirePermissions([PERMISSIONS.TEAM_UPDATE])
  async update(
    @CurrentOrgId() orgId: string,
    @Param('id') id: string,
    @Body() dto: UpdateTeamDto,
  ) {
    return this.teamsService.update(id, orgId, dto);
  }

  // DELETE operation - often admin-only
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

// ============================================
// EXAMPLE 2: Admin-Only Endpoints (Role-Based)
// ============================================

import { RequireRole, ROLES } from '../rbac';

@Controller('organizations/:orgId/admin')
@UseGuards(JwtAuthGuard, OrgContextGuard, RBACGuard)
export class AdminController {

  // Only OWNER or ADMIN can access
  @Delete('members/:userId')
  @RequireRole(ROLES.OWNER, ROLES.ADMIN)
  async removeMember(
    @CurrentOrgId() orgId: string,
    @Param('userId') userId: string,
  ) {
    return this.adminService.removeMember(orgId, userId);
  }

  // Only OWNER can manage billing
  @Put('subscription')
  @RequireRole(ROLES.OWNER)
  async updateSubscription(
    @CurrentOrgId() orgId: string,
    @Body() dto: UpdateSubscriptionDto,
  ) {
    return this.billingService.updateSubscription(orgId, dto);
  }
}

// ============================================
// EXAMPLE 3: Multiple Permissions (ANY mode)
// ============================================

@Controller('players')
@UseGuards(JwtAuthGuard, OrgContextGuard, RBACGuard)
export class PlayersController {

  // User needs EITHER player.update OR player.delete
  @Put(':id/archive')
  @RequirePermissions([PERMISSIONS.PLAYER_UPDATE, PERMISSIONS.PLAYER_DELETE])
  async archive(@Param('id') id: string) {
    return this.playersService.archive(id);
  }
}

// ============================================
// EXAMPLE 4: Multiple Permissions (ALL mode)
// ============================================

@Controller('analytics')
@UseGuards(JwtAuthGuard, OrgContextGuard, RBACGuard)
export class AnalyticsController {

  // User needs BOTH analytics.view AND analytics.export
  @Get('export')
  @RequirePermissions(
    [PERMISSIONS.ANALYTICS_VIEW, PERMISSIONS.ANALYTICS_EXPORT],
    'ALL'
  )
  async exportData(@CurrentOrgId() orgId: string) {
    return this.analyticsService.export(orgId);
  }
}

// ============================================
// EXAMPLE 5: Mixed Permission & Role Check
// ============================================

@Controller('organizations/:orgId/billing')
@UseGuards(JwtAuthGuard, OrgContextGuard, RBACGuard)
export class BillingController {

  // EITHER has billing permission OR is OWNER
  // (RBACGuard checks both, grants if either matches)
  @Post('upgrade')
  @RequirePermissions([PERMISSIONS.ORG_BILLING_MANAGE])
  @RequireRole(ROLES.OWNER)
  async upgrade(@CurrentOrgId() orgId: string) {
    return this.billingService.upgrade(orgId);
  }
}

// ============================================
// EXAMPLE 6: Using Full RBAC Context
// ============================================

import { RBACContext as RBACContextType } from '../rbac';

@Controller('profile')
@UseGuards(JwtAuthGuard, OrgContextGuard, RBACGuard)
export class ProfileController {

  @Get('me')
  async getProfile(
    @CurrentUserId() userId: string,
    @CurrentOrgId() orgId: string,
    @RBACContext() rbacContext: {
      userId: string;
      orgId: string;
      role: string;
      permissions: string[];
    },
  ) {
    return {
      userId,
      orgId,
      role: rbacContext.role,
      permissions: rbacContext.permissions,
    };
  }
}

// ============================================
// EXAMPLE 7: Optional Org Context
// ============================================

// Some endpoints might work with OR without org context
// OrgContextGuard allows this by default

@Controller('users')
@UseGuards(JwtAuthGuard, OrgContextGuard)
export class UsersController {

  // Works without orgId (global user info)
  @Get('me')
  async getMe(@CurrentUserId() userId: string) {
    return this.usersService.findById(userId);
  }

  // Requires orgId (org-specific info)
  @Get(':orgId/profile')
  @OrgScoped() // Makes orgId mandatory
  async getOrgProfile(
    @CurrentUserId() userId: string,
    @CurrentOrgId() orgId: string,
  ) {
    return this.usersService.getOrgProfile(userId, orgId);
  }
}

// ============================================
// EXAMPLE 8: Service-Level Permission Check
// ============================================

import { Injectable } from '@nestjs/common';
import { RBACService, PERMISSIONS } from '../rbac';

@Injectable()
export class TeamsService {
  constructor(private readonly rbacService: RBACService) {}

  async deleteTeam(teamId: string, userId: string, orgId: string) {
    // Manual permission check in service layer
    const hasPermission = await this.rbacService.hasPermission(
      userId,
      orgId,
      PERMISSIONS.TEAM_DELETE,
    );

    if (!hasPermission) {
      throw new ForbiddenException('You cannot delete teams');
    }

    // Business logic...
    return this.prisma.team.delete({ where: { id: teamId } });
  }

  async hasAdminAccess(userId: string, orgId: string): Promise<boolean> {
    // Check if user has admin role
    return this.rbacService.hasRole(userId, orgId, [ROLES.OWNER, ROLES.ADMIN]);
  }
}

// ============================================
// EXAMPLE 9: Cache Invalidation
// ============================================

import { RBACCacheService } from '../rbac';

@Injectable()
export class MembershipsService {
  constructor(private readonly rbacCache: RBACCacheService) {}

  async updateMemberRole(membershipId: string, newRole: MembershipRole) {
    const membership = await this.prisma.membership.findUnique({
      where: { id: membershipId },
    });

    // Update role
    await this.prisma.membership.update({
      where: { id: membershipId },
      data: { role: newRole },
    });

    // Invalidate RBAC cache for this user-org
    await this.rbacCache.invalidate(membership.userId, membership.orgId);

    // Or invalidate all orgs for this user
    // await this.rbacCache.invalidateUser(membership.userId);

    // Or invalidate all users in this org
    // await this.rbacCache.invalidateOrg(membership.orgId);
  }
}

// ============================================
// EXAMPLE 10: WebSocket Integration
// ============================================

import { WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server } from 'socket.io';
import { EventBusService } from '../events/event-bus.service';
import { RBACEventType } from '../rbac';

@WebSocketGateway()
export class NotificationsGateway {
  @WebSocketServer() server: Server;

  constructor(private readonly eventBus: EventBusService) {
    // Listen for RBAC events
    this.eventBus.on('membership.updated', (event) => {
      // Notify user their role changed
      this.server.to(`user:${event.userId}`).emit(RBACEventType.ROLE_CHANGED, {
        orgId: event.organizationId,
        oldRole: event.payload.oldRole,
        newRole: event.payload.newRole,
        message: 'Your role has been updated',
      });
    });

    this.eventBus.on('membership.deleted', (event) => {
      // Notify user they were removed from org
      this.server.to(`user:${event.userId}`).emit('org.removed', {
        orgId: event.organizationId,
        message: 'You have been removed from this organization',
      });
    });
  }
}

// ============================================
// EXAMPLE 11: E2E Testing
// ============================================

describe('Teams RBAC (e2e)', () => {
  let app: INestApplication;

  it('should allow MEMBER to create teams', async () => {
    // Get token for user with MEMBER role
    const token = await getAuthToken('member@test.com');

    return request(app.getHttpServer())
      .post('/organizations/org-1/teams')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Test Team' })
      .expect(201); // ✅ Allowed - MEMBER has TEAM_CREATE
  });

  it('should deny READ_ONLY to create teams', async () => {
    const token = await getAuthToken('readonly@test.com');

    return request(app.getHttpServer())
      .post('/organizations/org-1/teams')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Test Team' })
      .expect(403); // ❌ Denied - READ_ONLY lacks TEAM_CREATE
  });

  it('should deny SUSPENDED member to create teams', async () => {
    // Suspend the member first
    await prisma.membership.update({
      where: { userId_orgId: { userId: 'user-1', orgId: 'org-1' } },
      data: { status: 'SUSPENDED' },
    });

    const token = await getAuthToken('suspended@test.com');

    return request(app.getHttpServer())
      .post('/organizations/org-1/teams')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Test Team' })
      .expect(403); // ❌ Denied - Membership not ACTIVE
  });
});

// ============================================
// EXAMPLE 12: Custom Permission Check Decorator
// ============================================

// You can create custom decorators that combine RBAC with business logic

import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export const TeamOwner = createParamDecorator(
  async (data: unknown, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    const teamId = request.params.teamId;
    const userId = request.user.dbUserId;

    // Custom logic: check if user owns the team
    const team = await prisma.team.findUnique({
      where: { id: teamId },
      include: { organization: { include: { memberships: true } } },
    });

    const isOwner = team?.organization.memberships.some(
      (m) => m.userId === userId && m.role === 'OWNER',
    );

    return { isOwner, team };
  },
);

// Usage:
@Get('teams/:teamId')
async getTeam(@TeamOwner() { isOwner, team }) {
  if (!isOwner) {
    throw new ForbiddenException('Only team owners can access this');
  }
  return team;
}

// ============================================
// NOTES & BEST PRACTICES
// ============================================

/**
 * 1. ALWAYS use guards in this order:
 *    @UseGuards(JwtAuthGuard, OrgContextGuard, RBACGuard)
 * 
 * 2. PREFER permissions over roles:
 *    ✅ @RequirePermissions([PERMISSIONS.TEAM_CREATE])
 *    ⚠️ @RequireRole(ROLES.ADMIN)
 * 
 * 3. USE type-safe constants:
 *    ✅ PERMISSIONS.TEAM_CREATE
 *    ❌ 'team.create' (typo-prone)
 * 
 * 4. INVALIDATE cache when:
 *    - Role changes
 *    - Membership status changes
 *    - User removed from org
 * 
 * 5. TEST both allowed AND denied scenarios in E2E tests
 * 
 * 6. MONITOR Redis cache hit rate in production
 * 
 * 7. LOG sensitive actions for audit trail
 */
