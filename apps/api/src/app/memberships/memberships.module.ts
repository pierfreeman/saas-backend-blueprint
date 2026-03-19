import { Module } from '@nestjs/common';
import { TenantModule } from '@libs/common';
import { MembershipsModule as MembershipsLibModule } from '@libs/memberships';
import { MembershipsController } from './memberships.controller';
import { RBACModule } from '@libs/rbac';

@Module({
  imports: [MembershipsLibModule, RBACModule, TenantModule],
  controllers: [MembershipsController],
})
export class MembershipsModule {}
