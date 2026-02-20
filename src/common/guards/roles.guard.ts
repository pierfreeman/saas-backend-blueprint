import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { MembershipRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { MembershipsService } from '../../modules/memberships/memberships.service';
import { RequestUser } from '../../modules/auth/interfaces/request-user.interface';
import { RequestWithOrg } from './org-scope.guard';

export const ROLES_KEY = 'roles';
export const Roles = (...roles: MembershipRole[]) => SetMetadata(ROLES_KEY, roles);

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
    private readonly membershipsService: MembershipsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredRoles = this.reflector.getAllAndOverride<MembershipRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<RequestWithOrg>();
    const user = request.user as RequestUser;
    const orgId = request.orgId;

    if (!user) {
      throw new ForbiddenException('User not authenticated');
    }

    if (!orgId) {
      throw new ForbiddenException('Organization context not found');
    }

    // Get user from database
    const dbUser = await this.prisma.user.findUnique({
      where: { auth0Id: user.sub },
    });

    if (!dbUser) {
      throw new ForbiddenException('User not found');
    }

    // Check if user has required role
    const hasRole = await this.membershipsService.hasRole(dbUser.id, orgId, requiredRoles);

    if (!hasRole) {
      throw new ForbiddenException('You do not have the required role to perform this action');
    }

    return true;
  }
}
