import { Module } from '@nestjs/common';
import { PrismaBusinessModule } from '@libs/prisma-business';
import { BillingModule } from '@libs/billing';
import { AdminBillingRepository } from './infrastructure/repositories/admin-billing.repository';
import { AdminBillingService } from './application/services/admin-billing.service';

@Module({
  imports: [PrismaBusinessModule, BillingModule],
  providers: [AdminBillingRepository, AdminBillingService],
  exports: [AdminBillingService],
})
export class AdminBillingModule {}
