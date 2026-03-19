import { Injectable, Logger } from '@nestjs/common';
import { CacheService } from '@libs/redis';
import { RBACContextData } from './rbac.service';

const RBAC_CACHE_PREFIX = 'rbac:user:';
const RBAC_CACHE_TTL = 600; // 10 minutes

/**
 * RBACCacheService
 *
 * Stores resolved RBACContextData in Redis to avoid repeated DB + role-resolution
 * on every authenticated request. The cache is invalidated when a membership
 * is created, updated, or deleted.
 */
@Injectable()
export class RBACCacheService {
  private readonly logger = new Logger(RBACCacheService.name);

  constructor(private readonly cache: CacheService) {}

  private key(userId: string, orgId: string): string {
    return `${RBAC_CACHE_PREFIX}${userId}:org:${orgId}`;
  }

  async get(userId: string, orgId: string): Promise<RBACContextData | null> {
    return this.cache.get<RBACContextData>(this.key(userId, orgId));
  }

  async set(context: RBACContextData): Promise<void> {
    await this.cache.set(
      this.key(context.userId, context.orgId),
      context,
      RBAC_CACHE_TTL,
    );
  }

  async invalidate(userId: string, orgId: string): Promise<void> {
    await this.cache.del(this.key(userId, orgId));
    this.logger.debug(
      `Invalidated RBAC cache for user ${userId} in org ${orgId}`,
    );
  }

  async invalidateUser(userId: string): Promise<void> {
    const pattern = `${RBAC_CACHE_PREFIX}${userId}:org:*`;
    const keys = await this.cache.keys(pattern);
    if (keys.length > 0) {
      await Promise.all(keys.map((k) => this.cache.del(k)));
      this.logger.debug(
        `Invalidated ${keys.length} RBAC cache entries for user ${userId}`,
      );
    }
  }

  async invalidateOrg(orgId: string): Promise<void> {
    const pattern = `${RBAC_CACHE_PREFIX}*:org:${orgId}`;
    const keys = await this.cache.keys(pattern);
    if (keys.length > 0) {
      await Promise.all(keys.map((k) => this.cache.del(k)));
      this.logger.debug(
        `Invalidated ${keys.length} RBAC cache entries for org ${orgId}`,
      );
    }
  }
}
