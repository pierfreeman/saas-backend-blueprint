import { Module } from '@nestjs/common';
import { PrismaBusinessModule } from '@libs/prisma-business';
import { ActivityLogModule } from '@libs/activity-log';
import { LegalAuditModule } from '@libs/legal-audit';
import { NotificationsModule } from '@libs/notifications';
import { PlanningRepository } from './infrastructure/repositories/planning.repository';
import { RecurrenceService } from './application/services/recurrence.service';
import { PlanningService } from './application/services/planning.service';

@Module({
  imports: [
    PrismaBusinessModule,
    ActivityLogModule,
    LegalAuditModule,
    NotificationsModule,
  ],
  providers: [PlanningRepository, RecurrenceService, PlanningService],
  exports: [PlanningService],
})
export class PlanningModule {}
