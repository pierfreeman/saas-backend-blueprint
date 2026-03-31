import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaBusinessModule } from '@libs/prisma-business';
import { EventsModule } from '@libs/events';
import { LegalAuditModule } from '@libs/legal-audit';
import { ActivityLogModule } from '@libs/activity-log';
import { StorageModule } from '@libs/storage';
import { EmailModule } from '@libs/email';
import { OrgExportService } from './application/services/org-export.service';
import { OrgExportWorkerService } from './application/services/org-export-worker.service';
import { OrgExportSchedulerService } from './application/services/org-export-scheduler.service';
import { OrgExportRepository } from './infrastructure/repositories/org-export.repository';

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
    EmailModule,
  ],
  providers: [
    OrgExportRepository,
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
