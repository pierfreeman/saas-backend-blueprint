import { Module } from '@nestjs/common';
import { PrismaBusinessModule } from '@libs/prisma-business';
import { JobRepository } from './infrastructure/repositories/job.repository';

/**
 * JobsModule
 * Provides and exports `JobRepository` for use by any app that needs
 * to create, query, or update background Job records.
 */
@Module({
  imports: [PrismaBusinessModule],
  providers: [JobRepository],
  exports: [JobRepository],
})
export class JobsModule {}
