import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

export interface BruteForceResult {
  /** Whether the identifier is currently locked out */
  locked: boolean;
  /** Current number of failed attempts in the tracking window */
  attempts: number;
  /** Seconds until the lockout expires (0 when not locked) */
  lockoutRemainingSeconds: number;
}

/**
 * BruteForceService
 *
 * Distributed Redis-backed brute-force / credential-stuffing protection.
 *
 * Tracking axes:
 *  - IP address (`ip:<ip>`)
 *  - User identifier (`user:<userId>` or `email:<email>`)
 *
 * Mechanism:
 *  1. `recordFailedAttempt(identifier)` increments the attempt counter.
 *     If the counter reaches `maxAttempts`, a lock key is created for
 *     `lockoutTtl` seconds. Attempt counters expire after `trackingTtl`.
 *  2. `isLocked(identifier)` checks for an active lock key.
 *  3. `resetAttempts(identifier)` removes both keys — call on successful auth.
 *
 * Key patterns:
 *  - `bf:attempts:<identifier>` — attempt counter (TTL = trackingTtl)
 *  - `bf:lock:<identifier>`     — lockout flag   (TTL = lockoutTtl)
 *
 * Uses a dedicated Redis DB (DB=2, shared with rate-limit) to isolate from
 * business data. Fails open when Redis is unavailable.
 */
@Injectable()
export class BruteForceService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BruteForceService.name);
  private client!: Redis;

  private maxAttempts!: number;
  private lockoutTtl!: number;
  private trackingTtl!: number;

  constructor(private readonly configService: ConfigService) {}

  onModuleInit(): void {
    this.maxAttempts =
      this.configService.get<number>('security.bruteForce.maxAttempts') ?? 5;
    this.lockoutTtl =
      this.configService.get<number>('security.bruteForce.lockoutTtl') ?? 900;
    this.trackingTtl =
      this.configService.get<number>('security.bruteForce.trackingTtl') ?? 3600;

    this.client = new Redis({
      host: this.configService.get<string>('redis.host') ?? 'localhost',
      port: this.configService.get<number>('redis.port') ?? 6379,
      password: this.configService.get<string>('redis.password') ?? undefined,
      db: 2, // shared with rate-limit, isolated from business data
      retryStrategy: (times: number) => Math.min(times * 50, 2000),
      maxRetriesPerRequest: 3,
      lazyConnect: false,
    });

    this.client.on('error', (err: Error) => {
      this.logger.error('BruteForceService Redis error', err.message);
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.quit();
  }

  /**
   * Records a failed authentication attempt and returns current state.
   * If attempts reach `maxAttempts`, a lockout is applied atomically.
   */
  async recordFailedAttempt(identifier: string): Promise<BruteForceResult> {
    try {
      const attemptsKey = `bf:attempts:${identifier}`;
      const lockKey = `bf:lock:${identifier}`;

      // Do not record if already locked
      const locked = await this.client.exists(lockKey);
      if (locked) {
        const lockoutRemainingSeconds = Math.max(
          0,
          await this.client.ttl(lockKey),
        );
        return {
          locked: true,
          attempts: this.maxAttempts,
          lockoutRemainingSeconds,
        };
      }

      const count = await this.client.incr(attemptsKey);
      if (count === 1) {
        await this.client.expire(attemptsKey, this.trackingTtl);
      }

      if (count >= this.maxAttempts) {
        await this.client.set(lockKey, '1', 'EX', this.lockoutTtl);
        this.logger.warn(
          `Brute-force lockout triggered for identifier ${identifier} after ${count} attempts`,
        );
        return {
          locked: true,
          attempts: count,
          lockoutRemainingSeconds: this.lockoutTtl,
        };
      }

      return { locked: false, attempts: count, lockoutRemainingSeconds: 0 };
    } catch (err) {
      this.logger.error(
        `recordFailedAttempt failed for identifier "${identifier}", failing open`,
        err instanceof Error ? err.message : String(err),
      );
      return { locked: false, attempts: 0, lockoutRemainingSeconds: 0 };
    }
  }

  /** Returns true if the identifier is currently locked out */
  async isLocked(identifier: string): Promise<boolean> {
    try {
      const lockKey = `bf:lock:${identifier}`;
      return (await this.client.exists(lockKey)) > 0;
    } catch (err) {
      this.logger.error(
        `isLocked check failed for "${identifier}", failing open`,
        err instanceof Error ? err.message : String(err),
      );
      return false; // fail open
    }
  }

  /** Returns full brute-force state for an identifier */
  async getState(identifier: string): Promise<BruteForceResult> {
    try {
      const lockKey = `bf:lock:${identifier}`;
      const attemptsKey = `bf:attempts:${identifier}`;

      const [locked, attemptsStr, lockTtl] = await Promise.all([
        this.client.exists(lockKey),
        this.client.get(attemptsKey),
        this.client.ttl(lockKey),
      ]);

      return {
        locked: locked > 0,
        attempts: Number.parseInt(attemptsStr ?? '0', 10),
        lockoutRemainingSeconds: locked > 0 ? Math.max(0, lockTtl) : 0,
      };
    } catch (err) {
      this.logger.error(
        `getState failed for "${identifier}"`,
        err instanceof Error ? err.message : String(err),
      );
      return { locked: false, attempts: 0, lockoutRemainingSeconds: 0 };
    }
  }

  /**
   * Resets all brute-force counters for the given identifier.
   * Call this on successful authentication to clear the strike record.
   */
  async resetAttempts(identifier: string): Promise<void> {
    try {
      const attemptsKey = `bf:attempts:${identifier}`;
      const lockKey = `bf:lock:${identifier}`;
      await this.client.del(attemptsKey, lockKey);
    } catch (err) {
      this.logger.error(
        `resetAttempts failed for "${identifier}"`,
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  /** Expose the underlying Redis client for testing */
  getClient(): Redis {
    return this.client;
  }
}
