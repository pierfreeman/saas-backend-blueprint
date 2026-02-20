import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '../../../redis/redis.service';
import { RBACContext } from './rbac.service';

const RBAC_CACHE_PREFIX = 'rbac:user:';
const RBAC_CACHE_TTL = 600; // 10 minutes

@Injectable()
export class RBACCacheService {
  private readonly logger = new Logger(RBACCacheService.name);

  constructor(private readonly redis: RedisService) {}

  /**
   * Get cache key for user-org context
   */
  private getCacheKey(userId: string, orgId: string): string {
    return `${RBAC_CACHE_PREFIX}${userId}:org:${orgId}`;
  }

  /**
   * Get cached RBAC context
   */
  async get(userId: string, orgId: string): Promise<RBACContext | null> {
    try {
      const key = this.getCacheKey(userId, orgId);
      const cached = await this.redis.get(key);

      if (!cached) {
        return null;
      }

      return JSON.parse(cached) as RBACContext;
    } catch (error) {
      this.logger.error(`Error getting RBAC cache for user ${userId}:`, error);
      return null;
    }
  }

  /**
   * Set RBAC context in cache
   */
  async set(context: RBACContext): Promise<void> {
    try {
      const key = this.getCacheKey(context.userId, context.orgId);
      await this.redis.set(key, JSON.stringify(context), RBAC_CACHE_TTL);
    } catch (error) {
      this.logger.error(`Error setting RBAC cache for user ${context.userId}:`, error);
    }
  }

  /**
   * Invalidate cache for specific user-org
   */
  async invalidate(userId: string, orgId: string): Promise<void> {
    try {
      const key = this.getCacheKey(userId, orgId);
      await this.redis.del(key);
      this.logger.debug(`Invalidated RBAC cache for user ${userId} in org ${orgId}`);
    } catch (error) {
      this.logger.error(`Error invalidating RBAC cache:`, error);
    }
  }

  /**
   * Invalidate all cache entries for a user (across all orgs)
   */
  async invalidateUser(userId: string): Promise<void> {
    try {
      const pattern = `${RBAC_CACHE_PREFIX}${userId}:org:*`;
      const keys = await this.redis.keys(pattern);

      if (keys.length > 0) {
        await Promise.all(keys.map((key) => this.redis.del(key)));
        this.logger.debug(`Invalidated ${keys.length} RBAC cache entries for user ${userId}`);
      }
    } catch (error) {
      this.logger.error(`Error invalidating user RBAC cache:`, error);
    }
  }

  /**
   * Invalidate all cache entries for an org (all users)
   */
  async invalidateOrg(orgId: string): Promise<void> {
    try {
      const pattern = `${RBAC_CACHE_PREFIX}*:org:${orgId}`;
      const keys = await this.redis.keys(pattern);

      if (keys.length > 0) {
        await Promise.all(keys.map((key) => this.redis.del(key)));
        this.logger.debug(`Invalidated ${keys.length} RBAC cache entries for org ${orgId}`);
      }
    } catch (error) {
      this.logger.error(`Error invalidating org RBAC cache:`, error);
    }
  }

  /**
   * Clear all RBAC cache
   */
  async clearAll(): Promise<void> {
    try {
      const pattern = `${RBAC_CACHE_PREFIX}*`;
      const keys = await this.redis.keys(pattern);

      if (keys.length > 0) {
        await Promise.all(keys.map((key) => this.redis.del(key)));
        this.logger.log(`Cleared ${keys.length} RBAC cache entries`);
      }
    } catch (error) {
      this.logger.error(`Error clearing RBAC cache:`, error);
    }
  }
}
