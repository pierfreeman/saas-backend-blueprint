import { Module } from '@nestjs/common';
import { ActivityLogModule } from '@libs/activity-log';
import { LegalAuditModule } from '@libs/legal-audit';
import { PrismaBusinessModule } from '@libs/prisma-business';
import { JobRepository } from './infrastructure/repositories/job.repository';
import { JobService } from './application/services/job.service';

/**
 * JobsModule
 * Provides JobService (application layer) for use by any app that needs
 * to create, query, or update background Job records.
 */
@Module({
  imports: [ActivityLogModule, LegalAuditModule, PrismaBusinessModule],
  providers: [JobRepository, JobService],
  exports: [JobService],
})
export class JobsModule {}
