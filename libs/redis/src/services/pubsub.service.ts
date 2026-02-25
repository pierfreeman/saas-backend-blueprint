import { Injectable, Logger } from '@nestjs/common';
import Redis from 'ioredis';

/**
 * Pub/Sub Service
 * Handles publishing and subscription of events via Redis
 */
@Injectable()
export class PubSubService {
  private readonly logger = new Logger(PubSubService.name);
  private redis: Redis;

  constructor() {
    this.redis = new Redis({
      host: process.env['REDIS_HOST'] || 'localhost',
      port: parseInt(process.env['REDIS_PORT'] || '6379'),
      retryStrategy: (times: number) => {
        const delay = Math.min(times * 50, 2000);
        return delay;
      },
    });

    this.redis.on('connect', () => {
      this.logger.log('Redis Pub/Sub connected');
    });

    this.redis.on('error', (error) => {
      this.logger.error('Redis Pub/Sub error:', error);
    });
  }

  /**
   * Publish message to Redis channel
   */
  async publish(channel: string, payload: any): Promise<void> {
    try {
      const message = JSON.stringify(payload);
      const result = await this.redis.publish(channel, message);
      this.logger.debug(`Published to ${channel}, subscribers: ${result}`);
    } catch (error) {
      this.logger.error(`Failed to publish to ${channel}:`, error);
      throw error;
    }
  }

  /**
   * Get Redis instance for advanced use cases
   */
  getRedis(): Redis {
    return this.redis;
  }

  /**
   * Graceful shutdown
   */
  async onModuleDestroy() {
    this.logger.log('Disconnecting Redis Pub/Sub...');
    await this.redis.quit();
  }
}
