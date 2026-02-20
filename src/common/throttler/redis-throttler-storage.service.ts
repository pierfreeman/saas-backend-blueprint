import { Injectable } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import type { ThrottlerStorageRecord } from '@nestjs/throttler/dist/throttler-storage-record.interface';
import { RedisService } from '../../redis/redis.service';

@Injectable()
export class RedisThrottlerStorage implements ThrottlerStorage {
  constructor(private readonly redisService: RedisService) {}

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    const client = this.redisService.getClient();
    const prefixedKey = `throttle:${throttlerName}:${key}`;

    const current = await client.incr(prefixedKey);

    // Set expiry only on first increment
    if (current === 1) {
      await client.expire(prefixedKey, ttl);
    }

    const ttlRemaining = await client.ttl(prefixedKey);
    const isBlocked = current > limit;

    return {
      totalHits: current,
      timeToExpire: ttlRemaining > 0 ? ttlRemaining * 1000 : 0,
      isBlocked,
      timeToBlockExpire: isBlocked && ttlRemaining > 0 ? ttlRemaining * 1000 : 0,
    };
  }
}
