import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaBusinessModule } from '@libs/prisma-business';
import { EventsModule } from '@libs/events';
import { LegalAuditModule } from '@libs/legal-audit';
import { ActivityLogModule } from '@libs/activity-log';
import { RedisModule } from '@libs/redis';
import { StorageModule } from '@libs/storage';
import { BillingModule } from '@libs/billing';
import { EmailModule } from '@libs/email';
import { OrgDeletionService } from './application/services/org-deletion.service';
import { OrgDeletionWorkerService } from './application/services/org-deletion-worker.service';
import { OrgDeletionSchedulerService } from './application/services/org-deletion-scheduler.service';
import { OrgDeletionRepository } from './infrastructure/repositories/org-deletion.repository';

@Module({
  imports: [
    ConfigModule,
    PrismaBusinessModule,
    EventsModule,
    LegalAuditModule,
    ActivityLogModule,
    RedisModule,
    StorageModule,
    BillingModule,
    EmailModule,
  ],
  providers: [
    OrgDeletionRepository,
    OrgDeletionService,
    OrgDeletionWorkerService,
    OrgDeletionSchedulerService,
  ],
  exports: [OrgDeletionService, OrgDeletionWorkerService],
})
export class OrgDeletionModule {}
