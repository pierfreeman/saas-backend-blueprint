import { Module } from '@nestjs/common';
import { PrismaModule } from '@libs/prisma';
import { RedisModule } from '@libs/redis';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';

@Module({
  imports: [PrismaModule, RedisModule],
  controllers: [HealthController],
  providers: [HealthService],
})
export class HealthModule {}
