import { PrismaService } from '@libs/prisma';
import { CacheService } from '@libs/redis';
import { Injectable, Logger } from '@nestjs/common';
// import { ConfigService } from '@nestjs/config';
// import Stripe from 'stripe';

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);
  // private readonly stripe: Stripe;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: CacheService,
    // private readonly configService: ConfigService,
  ) {
    // this.stripe = new Stripe(this.configService.get<string>('STRIPE_SECRET_KEY')!, {
    //   apiVersion: '2026-01-28.clover',
    // });
  }

  async checkHealth(): Promise<{
    status: string;
    timestamp: string;
    services: {
      database: { status: string; responseTime?: number };
      redis: { status: string; responseTime?: number };
      // stripe: { status: string };
    };
  }> {
    const dbHealth = await this.checkDatabase();
    const redisHealth = await this.checkRedis();
    // const stripeHealth = await this.checkStripe();

    const allHealthy = dbHealth.status === 'ok' && redisHealth.status === 'ok';
    // stripeHealth.status === 'ok';

    return {
      status: allHealthy ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      services: {
        database: dbHealth,
        redis: redisHealth,
        // stripe: stripeHealth,
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

  // private async checkStripe(): Promise<{ status: string }> {
  //   try {
  //     // Simple check - verify API key format
  //     // We don't want to actually call Stripe API on every health check
  //     const apiKey = this.configService.get<string>('STRIPE_SECRET_KEY');
  //     if (
  //       apiKey &&
  //       (apiKey.startsWith('sk_test_') || apiKey.startsWith('sk_live_'))
  //     ) {
  //       return { status: 'ok' };
  //     }
  //     return { status: 'misconfigured' };
  //   } catch (error) {
  //     this.logger.error('Stripe health check failed', error);
  //     return { status: 'error' };
  //   }
  // }
}
