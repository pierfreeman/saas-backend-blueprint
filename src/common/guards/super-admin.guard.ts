import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { RequestUser } from '../../modules/auth/interfaces/request-user.interface';

@Injectable()
export class SuperAdminGuard implements CanActivate {
  private readonly superAdminEmails: string[];

  constructor(private readonly configService: ConfigService) {
    // Super admin emails should be configured in environment variables
    const emails = this.configService.get<string>('SUPER_ADMIN_EMAILS', '');
    this.superAdminEmails = emails
      .split(',')
      .map((email) => email.trim())
      .filter((email) => email.length > 0);
  }

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const user = request.user as RequestUser | undefined;

    if (!user) {
      throw new ForbiddenException('User not authenticated');
    }

    if (!this.superAdminEmails.includes(user.email)) {
      throw new ForbiddenException('Access denied. Super admin privileges required.');
    }

    return true;
  }
}
