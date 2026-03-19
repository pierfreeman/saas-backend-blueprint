import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { UserRepository } from '@libs/users';
import { MembershipsService } from '@libs/memberships';
import { OrganizationsService } from '@libs/organizations';
import { RequestUser, TenantRequest } from '@libs/common';
import { ORG_SCOPED_KEY } from '../decorators/org-scoped.decorator';
import { MembershipStatus } from '@prisma/client';

export interface RequestWithOrgContext extends Request, TenantRequest {
  user: RequestUser & { dbUserId?: string };
  orgId?: string;
  membership?: {
    id: string;
    role: string;
    status: string;
  };
  rbacPermissions?: string[];
  rbacRole?: string;
}

/**
 * OrgContextGuard
 *
 * Pipeline position: after JwtAuthGuard, before RBACGuard.
 *
 * This guard:
 * 1. Extracts orgId from route params, query, body, or x-org-id header
 * 2. Resolves the DB user from the Auth0 JWT sub claim
 * 3. Validates the user has an ACTIVE membership in that organization
 * 4. Injects `orgId` and `user.dbUserId` into the request for downstream guards/controllers
 *
 * If no orgId is found and the route is NOT decorated with @OrgScoped(), the guard
 * passes through (non-org routes are unaffected).
 */
@Injectable()
export class OrgContextGuard implements CanActivate {
  private readonly logger = new Logger(OrgContextGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly userRepo: UserRepository,
    private readonly membershipsService: MembershipsService,
    private readonly orgsService: OrganizationsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithOrgContext>();
    const user = request.user;

    const isOrgScoped = this.reflector.getAllAndOverride<boolean>(
      ORG_SCOPED_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!user) {
      throw new ForbiddenException('User not authenticated');
    }

    // Resolve orgId from multiple sources.
    // Checks: params.orgId → params.id (for /organizations/:id routes) → query → body → header
    const orgId =
      request.params['orgId'] ??
      request.params['id'] ??
      (request.query['orgId'] as string | undefined) ??
      (request.body as { orgId?: string } | undefined)?.orgId ??
      (request.headers['x-org-id'] as string | undefined);

    if (!orgId) {
      if (isOrgScoped) {
        throw new BadRequestException('Organization ID is required');
      }
      return true;
    }

    // Resolve DB user from Auth0 sub
    let dbUser = await this.userRepo.findByAuth0Id(user.sub);

    if (!dbUser) {
      this.logger.log(`Auto-creating DB user for Auth0: ${user.sub}`);
      dbUser = await this.userRepo.createUser(
        user.sub,
        user.email ?? `${user.sub}@unknown.local`,
      );
    }

    // Verify active membership
    const membership = await this.membershipsService.findByUserAndOrg(
      dbUser.id,
      orgId,
    );

    if (!membership) {
      // OrganizationsService.findById throws NotFoundException if org doesn't exist,
      // otherwise we fall through to ForbiddenException (org exists, not a member).
      await this.orgsService.findById(orgId);
      throw new ForbiddenException('You are not a member of this organization');
    }

    if (membership.status !== MembershipStatus.ACTIVE) {
      throw new ForbiddenException(
        `Membership is ${membership.status.toLowerCase()}`,
      );
    }

    // Inject context into the request
    request.orgId = orgId;
    request.user.dbUserId = dbUser.id;
    request.membership = {
      id: membership.id,
      role: membership.role,
      status: membership.status,
    };

    // Sync into TenantContext (enrich stage-1 context or create if middleware missed it)
    request.tenantContext = {
      tenantId: orgId,
      userId: dbUser.id,
      role: membership.role,
      permissions: request.tenantContext?.permissions,
      timestamp: request.tenantContext?.timestamp ?? new Date(),
    };

    this.logger.debug(
      `Org context resolved: user=${dbUser.id}, org=${orgId}, role=${membership.role}`,
    );

    return true;
  }
}
