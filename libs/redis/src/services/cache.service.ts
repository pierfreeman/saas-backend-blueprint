import { Injectable, Logger } from '@nestjs/common';
import Redis from 'ioredis';

/**
 * Cache Service
 * Wrapper around Redis for caching operations
 *
 * TODO: Add TTL strategies, cache invalidation patterns
 */
@Injectable()
export class CacheService {
  private readonly logger = new Logger(CacheService.name);
  private redis: Redis;

  constructor() {
    this.redis = new Redis({
      host: process.env['REDIS_HOST'] || 'localhost',
      port: parseInt(process.env['REDIS_PORT'] || '6379'),
      db: 1, // Use different DB for cache
      retryStrategy: (times: number) => {
        const delay = Math.min(times * 50, 2000);
        return delay;
      },
    });

    this.redis.on('connect', () => {
      this.logger.log('Redis Cache connected');
    });

    this.redis.on('error', (error) => {
      this.logger.error('Redis Cache error:', error);
    });
  }

  /**
   * Get value from cache
   */
  async get<T>(key: string): Promise<T | null> {
    try {
      const value = await this.redis.get(key);
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
        await this.redis.setex(key, ttl, serialized);
      } else {
        await this.redis.set(key, serialized);
      }
      this.logger.debug(`Cache set for key ${key}`);
    } catch (error) {
      this.logger.error(`Cache set failed for key ${key}:`, error);
    }
  }

  /**
   * Delete key from cache
   */
  async delete(key: string): Promise<void> {
    try {
      await this.redis.del(key);
      this.logger.debug(`Cache deleted for key ${key}`);
    } catch (error) {
      this.logger.error(`Cache delete failed for key ${key}:`, error);
    }
  }

  /**
   * Clear all cache (use with caution)
   */
  async clear(): Promise<void> {
    try {
      await this.redis.flushdb();
      this.logger.log('Cache cleared');
    } catch (error) {
      this.logger.error('Cache clear failed:', error);
    }
  }

  /**
   * Graceful shutdown
   */
  async onModuleDestroy() {
    this.logger.log('Disconnecting Redis Cache...');
    await this.redis.quit();
  }
}
