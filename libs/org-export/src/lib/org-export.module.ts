import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaBusinessModule } from '@libs/prisma-business';
import { EventsModule } from '@libs/events';
import { LegalAuditModule } from '@libs/legal-audit';
import { ActivityLogModule } from '@libs/activity-log';
import { StorageModule } from '@libs/storage';
import { OrgExportService } from './org-export.service';
import { OrgExportWorkerService } from './org-export-worker.service';
import { OrgExportSchedulerService } from './org-export-scheduler.service';

/**
 * Module for organization data export functionality.
 * Provides services for GDPR-compliant data export with async job processing.
 */
@Module({
  imports: [
    ConfigModule,
    PrismaBusinessModule,
    EventsModule,
    LegalAuditModule,
    ActivityLogModule,
    StorageModule,
  ],
  providers: [
    OrgExportService,
    OrgExportWorkerService,
    OrgExportSchedulerService,
  ],
  exports: [
    OrgExportService,
    OrgExportWorkerService,
    OrgExportSchedulerService,
  ],
})
export class OrgExportModule {}
