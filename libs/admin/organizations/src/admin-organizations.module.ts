import { Module } from '@nestjs/common';
import { PrismaBusinessModule } from '@libs/prisma-business';
import { ActivityLogModule } from '@libs/activity-log';
import { FeatureFlagsModule } from '@libs/feature-flags';
import { AdminOrganizationsRepository } from './infrastructure/repositories/admin-organizations.repository';
import { AdminOrganizationsService } from './application/services/admin-organizations.service';

@Module({
  imports: [PrismaBusinessModule, ActivityLogModule, FeatureFlagsModule],
  providers: [AdminOrganizationsRepository, AdminOrganizationsService],
  exports: [AdminOrganizationsService],
})
export class AdminOrganizationsModule {}
