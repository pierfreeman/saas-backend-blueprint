import { Module } from '@nestjs/common';
import { ActivityLogService } from './activity-log.service';
import { PrismaBusinessModule } from '@libs/prisma-business';

/**
 * ActivityLogModule
 *
 * NestJS library module providing business-level activity logging.
 * Stores tenant-visible events in the app_audit schema of the business database.
 *
 * Import in any feature module that needs to emit activity log events:
 *   @Module({ imports: [ActivityLogModule], ... })
 *   export class OrganizationsModule {}
 *
 * This module does NOT depend on LegalAuditModule — they are fully independent.
 */
@Module({
  imports: [PrismaBusinessModule],
  providers: [ActivityLogService],
  exports: [ActivityLogService],
})
export class ActivityLogModule {}
