import { Module } from '@nestjs/common';
import { PrismaBusinessModule } from '@libs/prisma-business';
import { AdminJobsRepository } from './infrastructure/repositories/admin-jobs.repository';
import { AdminJobsService } from './application/services/admin-jobs.service';

@Module({
  imports: [PrismaBusinessModule],
  providers: [AdminJobsRepository, AdminJobsService],
  exports: [AdminJobsService],
})
export class AdminJobsModule {}
