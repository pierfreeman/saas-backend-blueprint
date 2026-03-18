import { Module } from '@nestjs/common';
import { TenantModule } from '@libs/common';
import { OrganizationsModule as OrganizationsLibModule } from '@libs/organizations';
import { OrgDeletionModule } from '@libs/org-deletion';
import { OrgExportModule } from '@libs/org-export';
import { OrganizationsController } from './organizations.controller';
import { ExportCompletedEmailHandler } from './event-handlers/export-completed-email.handler';
import { AuthModule } from '../auth/auth.module';
import { RBACModule } from '../rbac/rbac.module';
import { EmailModule } from '@libs/email';

@Module({
  imports: [
    OrganizationsLibModule,
    EmailModule,
    AuthModule,
    RBACModule,
    TenantModule,
    OrgDeletionModule,
    OrgExportModule,
  ],
  controllers: [OrganizationsController],
  providers: [ExportCompletedEmailHandler],
})
export class OrganizationsModule {}
