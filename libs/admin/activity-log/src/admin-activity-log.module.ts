import { Module } from '@nestjs/common';
import { PrismaBusinessModule } from '@libs/prisma-business';
import { ActivityLogModule } from '@libs/activity-log';
import { AdminActivityLogRepository } from './infrastructure/repositories/admin-activity-log.repository';
import { AdminActivityLogService } from './application/services/admin-activity-log.service';

@Module({
  imports: [PrismaBusinessModule, ActivityLogModule],
  providers: [AdminActivityLogRepository, AdminActivityLogService],
  exports: [AdminActivityLogService],
})
export class AdminActivityLogModule {}
