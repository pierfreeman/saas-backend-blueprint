import { Module } from '@nestjs/common';
import { PrismaBusinessModule } from '@libs/prisma-business';
import { ActivityLogModule } from '@libs/activity-log';
import { FeatureFlagsModule } from '@libs/feature-flags';
import { LegalAuditModule } from '@libs/legal-audit';
import { MembershipsModule } from '@libs/memberships';
import { OrgExportModule } from '@libs/org-export';
import { AdminOrganizationsRepository } from './infrastructure/repositories/admin-organizations.repository';
import { AdminOrganizationsService } from './application/services/admin-organizations.service';

@Module({
  imports: [
    PrismaBusinessModule,
    ActivityLogModule,
    FeatureFlagsModule,
    LegalAuditModule,
    MembershipsModule,
    OrgExportModule,
  ],
  providers: [AdminOrganizationsRepository, AdminOrganizationsService],
  exports: [AdminOrganizationsService],
})
export class AdminOrganizationsModule {}
