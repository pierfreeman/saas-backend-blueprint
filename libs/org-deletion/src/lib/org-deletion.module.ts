import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaBusinessModule } from '@libs/prisma-business';
import { EventsModule } from '@libs/events';
import { LegalAuditModule } from '@libs/legal-audit';
import { ActivityLogModule } from '@libs/activity-log';
import { RedisModule } from '@libs/redis';
import { StorageModule } from '@libs/storage';
import { OrgDeletionService } from './org-deletion.service';
import { OrgDeletionWorkerService } from './org-deletion-worker.service';

@Module({
  imports: [
    ConfigModule,
    PrismaBusinessModule,
    EventsModule,
    LegalAuditModule,
    ActivityLogModule,
    RedisModule,
    StorageModule,
  ],
  providers: [OrgDeletionService, OrgDeletionWorkerService],
  exports: [OrgDeletionService, OrgDeletionWorkerService],
})
export class OrgDeletionModule {}
