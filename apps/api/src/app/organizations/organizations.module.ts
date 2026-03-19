import { Module } from '@nestjs/common';
import { TenantModule } from '@libs/common';
import { OrganizationsModule as OrganizationsLibModule } from '@libs/organizations';
import { OrgDeletionModule } from '@libs/org-deletion';
import { OrgExportModule } from '@libs/org-export';
import { OrganizationsController } from './organizations.controller';
import { AuthModule } from '../auth/auth.module';
import { RBACModule } from '@libs/rbac';

@Module({
  imports: [
    OrganizationsLibModule,
    AuthModule,
    RBACModule,
    TenantModule,
    OrgDeletionModule,
    OrgExportModule,
  ],
  controllers: [OrganizationsController],
})
export class OrganizationsModule {}
