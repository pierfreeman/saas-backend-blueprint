import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

/** RFC 4122 UUID format check — avoids ESM-only uuid package import. */
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isValidUuid(value: string): boolean {
  return UUID_REGEX.test(value);
}

function toSingleString(
  value: string | string[] | undefined,
): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }

  return value;
}

import { Request } from 'express';
import { UsersService } from '@libs/users';
import { MembershipsService } from '@libs/memberships';
import { OrganizationsService } from '@libs/organizations';
import { RequestUser, TenantRequest } from '@libs/common';
import { ORG_SCOPED_KEY } from '../decorators/org-scoped.decorator';
import { ALLOW_SUSPENDED_KEY } from '../decorators/allow-suspended.decorator';
import { MembershipStatus, OrganizationStatus } from '@libs/prisma-business';

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
    private readonly usersService: UsersService,
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

    const allowSuspended = this.reflector.getAllAndOverride<boolean>(
      ALLOW_SUSPENDED_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!user) {
      throw new ForbiddenException('User not authenticated');
    }

    // Resolve orgId from multiple sources (in priority order).
    // params['id'] is included only when the route is explicitly @OrgScoped —
    // this allows /organizations/:id to work while preventing routes like
    // PATCH /notifications/:id/read from mapping the resource id to an org id.
    const rawOrgId =
      toSingleString(request.params['orgId']) ??
      (isOrgScoped ? toSingleString(request.params['id']) : undefined) ??
      toSingleString(request.query['orgId'] as string | string[] | undefined) ??
      toSingleString(
        (request.body as { orgId?: string | string[] } | undefined)?.orgId,
      ) ??
      toSingleString(
        request.headers['x-org-id'] as string | string[] | undefined,
      );

    // Always resolve the DB user from JWT sub — needed even when orgId is absent
    // so that request.user.dbUserId is available to controllers without org context.
    let dbUser = await this.usersService.findByAuth0Id(user.sub);

    if (!dbUser) {
      this.logger.log(`Auto-creating DB user for Auth0: ${user.sub}`);
      dbUser = await this.usersService.createUser(
        user.sub,
        user.email ?? `${user.sub}@unknown.local`,
      );
    }

    request.user.dbUserId = dbUser.id;

    if (!rawOrgId) {
      if (isOrgScoped) {
        throw new BadRequestException('Organization ID is required');
      }
      return true;
    }

    // Validate UUID format before querying Prisma to avoid database errors and 500s.
    if (!isValidUuid(rawOrgId)) {
      if (isOrgScoped) {
        throw new BadRequestException('Organization ID must be a valid UUID');
      }
      return true;
    }

    const orgId = rawOrgId;

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

    // Block access when the organization is suspended, unless the endpoint
    // explicitly opts out with @AllowSuspended() (e.g. GDPR export/deletion).
    if (!allowSuspended) {
      const org = await this.orgsService.findById(orgId);
      if (org.status === OrganizationStatus.SUSPENDED) {
        throw new ForbiddenException('Organization is suspended');
      }
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
