import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

export interface RateLimitResult {
  /** Whether the request is within the allowed limit */
  allowed: boolean;
  /** Requests remaining in the current window */
  remaining: number;
  /** Unix timestamp (seconds) when the current window resets */
  resetAt: number;
  /** Current count in the window */
  count: number;
}

/**
 * RateLimitService
 *
 * Distributed, Redis-backed fixed-window rate limiter.
 *
 * Supports three limiting axes:
 *  - Per client IP
 *  - Per authenticated user
 *  - Per tenant/organisation
 *
 * Uses a dedicated Redis DB (DB=2) to isolate rate-limit counters from
 * business cache data. Fails open on Redis errors to avoid blocking
 * traffic when the rate-limit store is unavailable.
 *
 * Key pattern: `rl:{axis}:{identifier}:{windowIndex}`
 */
@Injectable()
export class RateLimitService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RateLimitService.name);
  private client!: Redis;

  private ttl!: number;
  private maxPerIp!: number;
  private maxPerUser!: number;
  private maxPerTenant!: number;

  constructor(private readonly configService: ConfigService) {}

  onModuleInit(): void {
    this.ttl = this.configService.get<number>('security.rateLimit.ttl') ?? 60;
    this.maxPerIp =
      this.configService.get<number>('security.rateLimit.maxPerIp') ?? 100;
    this.maxPerUser =
      this.configService.get<number>('security.rateLimit.maxPerUser') ?? 200;
    this.maxPerTenant =
      this.configService.get<number>('security.rateLimit.maxPerTenant') ?? 1000;

    this.client = new Redis({
      host: this.configService.get<string>('redis.host') ?? 'localhost',
      port: this.configService.get<number>('redis.port') ?? 6379,
      password: this.configService.get<string>('redis.password') ?? undefined,
      db: 2, // dedicated DB for rate-limit counters
      retryStrategy: (times: number) => Math.min(times * 50, 2000),
      maxRetriesPerRequest: 3,
      lazyConnect: false,
    });

    this.client.on('error', (err: Error) => {
      this.logger.error('RateLimitService Redis error', err.message);
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.quit();
  }

  /** Check and increment rate limit counter for a client IP */
  async checkByIp(ip: string): Promise<RateLimitResult> {
    return this.check(`rl:ip:${ip}`, this.maxPerIp);
  }

  /** Check and increment rate limit counter for an authenticated user */
  async checkByUser(userId: string): Promise<RateLimitResult> {
    return this.check(`rl:user:${userId}`, this.maxPerUser);
  }

  /** Check and increment rate limit counter for a tenant */
  async checkByTenant(tenantId: string): Promise<RateLimitResult> {
    return this.check(`rl:tenant:${tenantId}`, this.maxPerTenant);
  }

  /**
   * Core fixed-window counter.
   * Window index = Math.floor(unixSeconds / ttl)
   * Key expires slightly after the window ends to handle clock drift.
   */
  private async check(baseKey: string, max: number): Promise<RateLimitResult> {
    try {
      const nowSeconds = Math.floor(Date.now() / 1000);
      const window = Math.floor(nowSeconds / this.ttl);
      const windowKey = `${baseKey}:${window}`;
      const resetAt = (window + 1) * this.ttl;

      const count = await this.client.incr(windowKey);

      // Set TTL only on first increment to avoid constant resets
      if (count === 1) {
        // TTL = remaining window time + 5s buffer to handle clock drift
        const windowRemainder = resetAt - nowSeconds;
        await this.client.expire(windowKey, windowRemainder + 5);
      }

      const remaining = Math.max(0, max - count);
      return { allowed: count <= max, remaining, resetAt, count };
    } catch (err) {
      // Fail open: allow traffic when Redis is unavailable
      this.logger.error(
        `Rate limit check failed for key "${baseKey}", failing open`,
        err instanceof Error ? err.message : String(err),
      );
      return { allowed: true, remaining: 1, resetAt: 0, count: 0 };
    }
  }

  /** Expose the underlying Redis client for testing purposes only */
  getClient(): Redis {
    return this.client;
  }
}
