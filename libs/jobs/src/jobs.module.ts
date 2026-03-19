import { Module } from '@nestjs/common';
import { PrismaBusinessModule } from '@libs/prisma-business';
import { JobRepository } from './infrastructure/repositories/job.repository';
import { JobService } from './application/services/job.service';

/**
 * JobsModule
 * Provides JobService (application layer) for use by any app that needs
 * to create, query, or update background Job records.
 */
@Module({
  imports: [PrismaBusinessModule],
  providers: [JobRepository, JobService],
  exports: [JobService],
})
export class JobsModule {}
