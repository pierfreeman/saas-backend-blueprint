import { StripeService } from '@libs/billing';
// eslint-disable-next-line @typescript-eslint/no-restricted-imports -- health checks probe the DB connection directly via $queryRaw; this is infrastructure, not domain logic
import { PrismaBusinessService } from '@libs/prisma-business';
import { CacheService } from '@libs/redis';
import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  constructor(
    private readonly prisma: PrismaBusinessService,
    private readonly redis: CacheService,
    private readonly stripeService: StripeService,
  ) {}

  async checkHealth(): Promise<{
    status: string;
    timestamp: string;
    services: {
      database: { status: string; responseTime?: number };
      redis: { status: string; responseTime?: number };
      stripe: { status: string; responseTime?: number };
    };
  }> {
    const dbHealth = await this.checkDatabase();
    const redisHealth = await this.checkRedis();
    const stripeHealth = await this.checkStripe();

    const allHealthy =
      dbHealth.status === 'ok' &&
      redisHealth.status === 'ok' &&
      stripeHealth.status === 'ok';

    return {
      status: allHealthy ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      services: {
        database: dbHealth,
        redis: redisHealth,
        stripe: stripeHealth,
      },
    };
  }

  async checkReadiness(): Promise<boolean> {
    try {
      const dbReady = await this.checkDatabase();
      const redisReady = await this.checkRedis();
      return dbReady.status === 'ok' && redisReady.status === 'ok';
    } catch (error) {
      this.logger.error('Readiness check failed', error);
      return false;
    }
  }

  private async checkDatabase(): Promise<{
    status: string;
    responseTime?: number;
  }> {
    try {
      const start = Date.now();
      await this.prisma.$queryRaw`SELECT 1`;
      const responseTime = Date.now() - start;

      return {
        status: 'ok',
        responseTime,
      };
    } catch (error) {
      this.logger.error('Database health check failed', error);
      return {
        status: 'error',
      };
    }
  }

  private async checkRedis(): Promise<{
    status: string;
    responseTime?: number;
  }> {
    try {
      const client = this.redis.getClient();
      const start = Date.now();
      await client.ping();
      const responseTime = Date.now() - start;

      return {
        status: 'ok',
        responseTime,
      };
    } catch (error) {
      this.logger.error('Redis health check failed', error);
      return {
        status: 'error',
      };
    }
  }

  private async checkStripe(): Promise<{
    status: string;
    responseTime?: number;
  }> {
    return this.stripeService.checkConnectivity();
  }
}
