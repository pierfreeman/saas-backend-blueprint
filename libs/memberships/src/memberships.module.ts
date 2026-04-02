import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaBusinessModule } from '@libs/prisma-business';
import { ActivityLogModule } from '@libs/activity-log';
import { LegalAuditModule } from '@libs/legal-audit';
import { EmailModule } from '@libs/email';
import { UsersModule } from '@libs/users';
import { OrganizationsModule } from '@libs/organizations';
import { EventsModule } from '@libs/events';
import { MembershipsService } from './application/services/memberships.service';
import { MembershipsRepository } from './infrastructure/repositories/memberships.repository';
import { UserInvitedEmailHandler } from './application/event-handlers/user-invited-email.handler';
import { InviteMemberService } from './application/services/invite-member.service';
import { RemoveMemberService } from './application/services/remove-member.service';

@Module({
  imports: [
    PrismaBusinessModule,
    ActivityLogModule,
    LegalAuditModule,
    EmailModule,
    UsersModule,
    OrganizationsModule,
    ConfigModule,
    EventsModule,
  ],
  providers: [
    MembershipsRepository,
    MembershipsService,
    UserInvitedEmailHandler,
    InviteMemberService,
    RemoveMemberService,
  ],
  exports: [
    MembershipsService,
    UserInvitedEmailHandler,
    InviteMemberService,
    RemoveMemberService,
  ],
})
export class MembershipsModule {}
