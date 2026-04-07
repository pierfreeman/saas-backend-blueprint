import { Module } from '@nestjs/common';
import { PrismaBusinessModule } from '@libs/prisma-business';
import { BillingModule } from '@libs/billing';
import { ActivityLogModule } from '@libs/activity-log';
import { LegalAuditModule } from '@libs/legal-audit';
import { AdminBillingRepository } from './infrastructure/repositories/admin-billing.repository';
import { AdminBillingService } from './application/services/admin-billing.service';

@Module({
  imports: [
    PrismaBusinessModule,
    BillingModule,
    ActivityLogModule,
    LegalAuditModule,
  ],
  providers: [AdminBillingRepository, AdminBillingService],
  exports: [AdminBillingService],
})
export class AdminBillingModule {}
