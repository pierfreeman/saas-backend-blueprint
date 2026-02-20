import { Module, forwardRef } from '@nestjs/common';
import { OrganizationsService } from './organizations.service';
import { OrganizationsController } from './organizations.controller';
import { MembershipsModule } from '../memberships/memberships.module';
import { RBACModule } from '../rbac/rbac.module';

@Module({
  imports: [forwardRef(() => MembershipsModule), RBACModule],
  controllers: [OrganizationsController],
  providers: [OrganizationsService],
  exports: [OrganizationsService],
})
export class OrganizationsModule {}
