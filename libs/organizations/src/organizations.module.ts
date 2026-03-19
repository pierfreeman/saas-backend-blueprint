import { Module } from '@nestjs/common';
import { PrismaBusinessModule } from '@libs/prisma-business';
import { ActivityLogModule } from '@libs/activity-log';
import { LegalAuditModule } from '@libs/legal-audit';
import { OrganizationsService } from './application/services/organizations.service';
import { OrganizationsRepository } from './infrastructure/repositories/organizations.repository';

@Module({
  imports: [PrismaBusinessModule, ActivityLogModule, LegalAuditModule],
  providers: [OrganizationsRepository, OrganizationsService],
  exports: [OrganizationsService, OrganizationsRepository],
})
export class OrganizationsModule {}
