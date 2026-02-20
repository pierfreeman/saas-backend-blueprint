import { Module, forwardRef } from '@nestjs/common';
import { MembershipsService } from './memberships.service';
import { MembershipsController } from './memberships.controller';
import { OrganizationsModule } from '../organizations/organizations.module';
import { RBACModule } from '../rbac/rbac.module';

@Module({
  imports: [forwardRef(() => OrganizationsModule), RBACModule],
  controllers: [MembershipsController],
  providers: [MembershipsService],
  exports: [MembershipsService],
})
export class MembershipsModule {}
