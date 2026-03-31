import { Module } from '@nestjs/common';
import { PrismaBusinessModule } from '@libs/prisma-business';
import { ActivityLogModule } from '@libs/activity-log';
import { LegalAuditModule } from '@libs/legal-audit';
import { EmailModule } from '@libs/email';
import { MembershipsService } from './application/services/memberships.service';
import { MembershipsRepository } from './infrastructure/repositories/memberships.repository';
import { UserInvitedEmailHandler } from './application/event-handlers/user-invited-email.handler';

@Module({
  imports: [
    PrismaBusinessModule,
    ActivityLogModule,
    LegalAuditModule,
    EmailModule,
  ],
  providers: [
    MembershipsRepository,
    MembershipsService,
    UserInvitedEmailHandler,
  ],
  exports: [MembershipsService, UserInvitedEmailHandler],
})
export class MembershipsModule {}
