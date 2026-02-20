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
import { PrismaService } from '../../../prisma/prisma.service';
import { MembershipsService } from '../../memberships/memberships.service';
import { RequestUser } from '../../auth/interfaces/request-user.interface';
import { ORG_SCOPED_KEY } from '../decorators/org-scoped.decorator';
import { MembershipStatus } from '@prisma/client';

export interface RequestWithOrgContext extends Request {
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
 * OrgContextGuard - Validates organization context and membership
 *
 * This guard:
 * 1. Extracts orgId from request (params, query, body, or header)
 * 2. Resolves the database user from Auth0 JWT
 * 3. Validates active membership in the organization
 * 4. Injects orgId and dbUserId into request for downstream use
 *
 * Usage:
 * - Apply globally or per-route
 * - Use @OrgScoped() decorator for explicit marking
 * - Automatically skips if no orgId found (opt-in behavior)
 */
@Injectable()
export class OrgContextGuard implements CanActivate {
  private readonly logger = new Logger(OrgContextGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
    private readonly membershipsService: MembershipsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithOrgContext>();
    const user = request.user;

    // Check if route is explicitly marked as org-scoped
    const isOrgScoped = this.reflector.getAllAndOverride<boolean>(ORG_SCOPED_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!user) {
      throw new ForbiddenException('User not authenticated');
    }

    // Extract orgId from multiple sources
    const orgId =
      request.params.orgId ||
      request.query.orgId ||
      (request.body as { orgId?: string })?.orgId ||
      request.headers['x-org-id'];

    // If no orgId and not explicitly org-scoped, allow request
    if (!orgId) {
      if (isOrgScoped) {
        throw new BadRequestException('Organization ID is required');
      }
      return true;
    }

    if (typeof orgId !== 'string') {
      throw new BadRequestException('Invalid organization ID format');
    }

    // Get or create database user
    let dbUser = await this.prisma.user.findUnique({
      where: { auth0Id: user.sub },
    });

    if (!dbUser) {
      // Auto-create user if doesn't exist
      this.logger.log(`Creating database user for Auth0: ${user.sub}`);
      dbUser = await this.prisma.user.create({
        data: {
          auth0Id: user.sub,
          email: user.email || `${user.sub}@unknown.local`,
        },
      });
    }

    // Verify membership exists and is active
    const membership = await this.prisma.membership.findUnique({
      where: {
        userId_orgId: {
          userId: dbUser.id,
          orgId,
        },
      },
    });

    if (!membership) {
      throw new ForbiddenException('You are not a member of this organization');
    }

    if (membership.status !== MembershipStatus.ACTIVE) {
      throw new ForbiddenException(`Membership is ${membership.status.toLowerCase()}`);
    }

    // Inject context into request
    request.orgId = orgId;
    request.user.dbUserId = dbUser.id;
    request.membership = {
      id: membership.id,
      role: membership.role,
      status: membership.status,
    };

    this.logger.debug(
      `Org context resolved: user=${dbUser.id}, org=${orgId}, role=${membership.role}`,
    );

    return true;
  }
}
