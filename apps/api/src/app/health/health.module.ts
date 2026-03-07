import { Module } from '@nestjs/common';
import { PrismaBusinessModule } from '@libs/prisma-business';
import { RedisModule } from '@libs/redis';
import { StripeClient } from '@libs/billing';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';

@Module({
  imports: [PrismaBusinessModule, RedisModule],
  controllers: [HealthController],
  providers: [HealthService, StripeClient],
})
export class HealthModule {}
