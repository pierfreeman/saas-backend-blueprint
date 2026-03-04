import { Module } from '@nestjs/common';
import { PrismaBusinessModule } from '@libs/prisma-business';
import { TenantModule } from '@libs/common';
import { ActivityLogModule } from '@libs/activity-log';
import { LegalAuditModule } from '@libs/legal-audit';
import { MembershipsService } from './memberships.service';
import { MembershipsController } from './memberships.controller';
import { RBACModule } from '../rbac/rbac.module';

@Module({
  imports: [PrismaBusinessModule, RBACModule, TenantModule, ActivityLogModule, LegalAuditModule],
  controllers: [MembershipsController],
  providers: [MembershipsService],
  exports: [MembershipsService],
})
export class MembershipsModule {}
