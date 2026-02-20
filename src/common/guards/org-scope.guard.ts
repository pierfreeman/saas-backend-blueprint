import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import { RequestUser } from '../../modules/auth/interfaces/request-user.interface';
import { MembershipsService } from '../../modules/memberships/memberships.service';

export interface RequestWithOrg extends Request {
  user: RequestUser;
  orgId?: string;
}

@Injectable()
export class OrgScopeGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly membershipsService: MembershipsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithOrg>();
    const user = request.user;

    if (!user) {
      throw new ForbiddenException('User not authenticated');
    }

    // Extract orgId from params, query, or body
    const orgId =
      request.params.orgId || request.query.orgId || (request.body as { orgId?: string })?.orgId;

    if (!orgId || typeof orgId !== 'string') {
      throw new BadRequestException('Organization ID is required');
    }

    // Get user from database
    const dbUser = await this.prisma.user.findUnique({
      where: { auth0Id: user.sub },
    });

    if (!dbUser) {
      throw new ForbiddenException('User not found');
    }

    // Verify membership
    await this.membershipsService.getMembershipOrThrow(dbUser.id, orgId);

    // Inject orgId into request
    request.orgId = orgId;

    return true;
  }
}
