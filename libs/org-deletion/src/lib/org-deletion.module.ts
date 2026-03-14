import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaBusinessModule } from '@libs/prisma-business';
import { EventsModule } from '@libs/events';
import { LegalAuditModule } from '@libs/legal-audit';
import { ActivityLogModule } from '@libs/activity-log';
import { RedisModule } from '@libs/redis';
import { StorageModule } from '@libs/storage';
import { OrgDeletionService } from './org-deletion.service';
import { OrgDeletionWorkerService } from './org-deletion-worker.service';
import { OrgDeletionSchedulerService } from './org-deletion-scheduler.service';

@Module({
  imports: [
    ConfigModule,
    ScheduleModule.forRoot(),
    PrismaBusinessModule,
    EventsModule,
    LegalAuditModule,
    ActivityLogModule,
    RedisModule,
    StorageModule,
  ],
  providers: [
    OrgDeletionService,
    OrgDeletionWorkerService,
    OrgDeletionSchedulerService,
  ],
  exports: [OrgDeletionService, OrgDeletionWorkerService],
})
export class OrgDeletionModule {}
