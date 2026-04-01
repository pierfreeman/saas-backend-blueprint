import { Module } from '@nestjs/common';
import { PrismaBusinessModule } from '@libs/prisma-business';
import { RedisModule } from '@libs/redis';
import { BillingModule } from '@libs/billing';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';

@Module({
  imports: [PrismaBusinessModule, RedisModule, BillingModule],
  controllers: [HealthController],
  providers: [HealthService],
})
export class HealthModule {}
