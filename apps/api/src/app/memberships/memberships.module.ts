import { Module } from '@nestjs/common';
import { PrismaModule } from '@libs/prisma';
import { TenantModule } from '@libs/common';
import { MembershipsService } from './memberships.service';
import { MembershipsController } from './memberships.controller';
import { RBACModule } from '../rbac/rbac.module';

@Module({
  imports: [PrismaModule, RBACModule, TenantModule],
  controllers: [MembershipsController],
  providers: [MembershipsService],
  exports: [MembershipsService],
})
export class MembershipsModule {}
