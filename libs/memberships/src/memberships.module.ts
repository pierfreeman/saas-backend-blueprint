import { Module } from '@nestjs/common';
import { PrismaBusinessModule } from '@libs/prisma-business';
import { ActivityLogModule } from '@libs/activity-log';
import { LegalAuditModule } from '@libs/legal-audit';
import { MembershipsService } from './memberships.service';
import { MembershipsRepository } from './infrastructure/repositories/memberships.repository';

@Module({
  imports: [PrismaBusinessModule, ActivityLogModule, LegalAuditModule],
  providers: [MembershipsRepository, MembershipsService],
  exports: [MembershipsService],
})
export class MembershipsModule {}
