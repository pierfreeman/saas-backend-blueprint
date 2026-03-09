import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import Redis from 'ioredis';

/**
 * Cache Service
 * Wrapper around Redis for caching operations
 *
 * TODO: Add TTL strategies, cache invalidation patterns
 */
@Injectable()
export class CacheService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CacheService.name);
  private readonly client: Redis;

  constructor() {
    this.client = new Redis({
      host: process.env['REDIS_HOST'] || 'localhost',
      port: Number.parseInt(process.env['REDIS_PORT'] || '6379'),
      db: 1, // Use different DB for cache
      retryStrategy: (times: number) => {
        const delay = Math.min(times * 50, 2000);
        return delay;
      },
      maxRetriesPerRequest: 3,
    });
  }

  /**
   * Attach Redis client event listeners on module startup
   */
  async onModuleInit(): Promise<void> {
    this.client.on('connect', () => {
      this.logger.log('Redis client connected');
    });

    this.client.on('error', (err: Error) => {
      this.logger.error('Redis client error', err);
    });

    this.client.on('ready', () => {
      this.logger.log('Redis client ready');
    });
  }

  /**
   * Graceful shutdown
   */
  async onModuleDestroy(): Promise<void> {
    this.logger.log('Disconnecting Redis client...');
    await this.client.quit();
  }

  /**
   * Return the underlying ioredis client instance
   */
  getClient(): Redis {
    return this.client;
  }

  /**
   * Get value from cache
   */
  async get<T>(key: string): Promise<T | null> {
    try {
      const value = await this.client.get(key);
      return value ? JSON.parse(value) : null;
    } catch (error) {
      this.logger.warn(`Cache get failed for key ${key}:`, error);
      return null;
    }
  }

  /**
   * Set value in cache with optional TTL (seconds)
   */
  async set<T>(key: string, value: T, ttl?: number): Promise<void> {
    try {
      const serialized = JSON.stringify(value);
      if (ttl) {
        await this.client.setex(key, ttl, serialized);
      } else {
        await this.client.set(key, serialized);
      }
      this.logger.debug(`Cache set for key ${key}`);
    } catch (error) {
      this.logger.error(`Cache set failed for key ${key}:`, error);
    }
  }

  /**
   * Delete key from cache
   */
  async del(key: string): Promise<void> {
    try {
      await this.client.del(key);
      this.logger.debug(`Cache deleted for key ${key}`);
    } catch (error) {
      this.logger.error(`Cache delete failed for key ${key}:`, error);
    }
  }

  /**
   * Check whether a key exists in the cache (returns 1 if present, 0 otherwise)
   */
  async exists(key: string): Promise<number> {
    return this.client.exists(key);
  }

  /**
   * Atomically increment the integer value stored at key by 1
   */
  async incr(key: string): Promise<number> {
    return this.client.incr(key);
  }

  /**
   * Set a TTL (seconds) on an existing key
   */
  async expire(key: string, seconds: number): Promise<number> {
    return this.client.expire(key, seconds);
  }

  /**
   * Return the remaining TTL (seconds) for a key, or -1 if no expiry, -2 if missing
   */
  async ttl(key: string): Promise<number> {
    return this.client.ttl(key);
  }

  /**
   * Return all keys matching the given glob-style pattern
   */
  async keys(pattern: string): Promise<string[]> {
    return this.client.keys(pattern);
  }

  /**
   * Flush all keys in the current Redis DB — only allowed outside production
   */
  async flushdb(): Promise<'OK'> {
    if (process.env['NODE_ENV'] === 'production') {
      throw new Error('Cannot flush Redis in production');
    }
    return this.client.flushdb();
  }
}
