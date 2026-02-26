import { Module } from '@nestjs/common';
import { PrismaModule } from '@libs/prisma';
import { TenantModule } from '@libs/common';
import { AuditModule } from '@libs/audit';
import { MembershipsService } from './memberships.service';
import { MembershipsController } from './memberships.controller';
import { RBACModule } from '../rbac/rbac.module';

@Module({
  imports: [PrismaModule, RBACModule, TenantModule, AuditModule],
  controllers: [MembershipsController],
  providers: [MembershipsService],
  exports: [MembershipsService],
})
export class MembershipsModule {}
