import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { BillingService } from '@libs/billing';
import { CacheService } from '@libs/redis';
import { LocalTransport, DomainEvent, DOMAIN_EVENTS } from '@libs/events';
import { BillingStatus } from '@libs/prisma-business';
import {
  PlanEntitlements,
  OrganizationEntitlements,
} from './interfaces/entitlements.interface';
import { EntitlementOverrideRepository } from './infrastructure/repositories/entitlement-override.repository';

export interface EntitlementOverrideRecord {
  id: string;
  orgId: string;
  key: string;
  value: boolean | number;
  reason: string;
  expiresAt: Date | null;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface SetOverrideParams {
  key: string;
  value: boolean | number;
  reason: string;
  expiresAt?: string;
  createdBy?: string;
}

type PlanTier = 'FREE' | 'PRO' | 'ENTERPRISE';
type LimitKey = 'maxTeams' | 'maxPlayers' | 'maxCoaches';

/**
 * Feature entitlements keyed by plan tier.
 * Changing entitlements for a tier takes effect on next cache miss.
 */
const PLAN_ENTITLEMENTS: Record<PlanTier, PlanEntitlements> = {
  FREE: {
    advancedAnalytics: false,
    customReports: false,
    apiAccess: false,
    ssoEnabled: false,
    prioritySupport: false,
    maxSeats: 3,
    storageLimitBytes: 100 * 1024 * 1024, // 100 MB
  },
  PRO: {
    advancedAnalytics: true,
    customReports: true,
    apiAccess: true,
    ssoEnabled: false,
    prioritySupport: false,
    maxSeats: 10,
    storageLimitBytes: 5 * 1024 * 1024 * 1024, // 5 GB
  },
  ENTERPRISE: {
    advancedAnalytics: true,
    customReports: true,
    apiAccess: true,
    ssoEnabled: true,
    prioritySupport: true,
    maxSeats: 999999,
    storageLimitBytes: 50 * 1024 * 1024 * 1024, // 50 GB
  },
};

/**
 * Numeric resource limits keyed by plan tier.
 * 999999 is used as a practical "unlimited" ceiling for ENTERPRISE.
 */
const PLAN_LIMITS: Record<PlanTier, Record<LimitKey, number>> = {
  FREE: { maxTeams: 2, maxPlayers: 20, maxCoaches: 2 },
  PRO: { maxTeams: 10, maxPlayers: 200, maxCoaches: 10 },
  ENTERPRISE: { maxTeams: 999999, maxPlayers: 999999, maxCoaches: 999999 },
};

/**
 * FeatureFlagsService
 *
 * Derives plan entitlements from an organization's billing state stored
 * on the Organization record (planId + billingStatus). No separate
 * feature_flags table is required — all logic is tier-based.
 *
 * Cache strategy:
 *   - Redis key: `entitlements:<orgId>`, TTL controlled by FEATURE_FLAGS_CACHE_TTL.
 *   - Auto-invalidated on subscription state change events (local mode).
 *   - Manual invalidation available via invalidateEntitlements().
 *
 * Plan tier resolution:
 *   - planId === STRIPE_PRICE_ID_PRO   → PRO tier
 *   - planId === STRIPE_PRICE_ID_ENTERPRISE → ENTERPRISE tier
 *   - Otherwise                        → FREE tier
 *   - billingStatus !== ACTIVE         → FREE tier (overrides plan)
 */
@Injectable()
export class FeatureFlagsService implements OnModuleInit {
  private readonly logger = new Logger(FeatureFlagsService.name);
  private readonly cacheTtl = Number.parseInt(
    process.env['FEATURE_FLAGS_CACHE_TTL'] ?? '600',
    10,
  );
  private readonly cacheKeyPrefix = 'entitlements:';

  constructor(
    private readonly billingService: BillingService,
    private readonly cache: CacheService,
    private readonly localTransport: LocalTransport,
    private readonly overrideRepository: EntitlementOverrideRepository,
  ) {}

  /**
   * Subscribes to subscription state change events so the entitlements cache
   * is invalidated automatically when a plan changes.
   *
   * Note: this listener is active only when EVENT_BUS_TRANSPORT=local (default).
   * In SQS mode, rely on TTL expiry or the POST /entitlements/invalidate endpoint.
   */
  onModuleInit(): void {
    const handler = async (event: DomainEvent): Promise<void> => {
      const orgId = event.payload['orgId'] as string | undefined;
      if (orgId) {
        await this.invalidateEntitlements(orgId);
        this.logger.debug(
          `Cache invalidated for org ${orgId} on event: ${event.eventType}`,
        );
      }
    };

    this.localTransport.on(DOMAIN_EVENTS.SUBSCRIPTION_PLAN_CHANGED, handler);
    this.localTransport.on(
      DOMAIN_EVENTS.BILLING_SUBSCRIPTION_CANCELLED,
      handler,
    );
    this.localTransport.on(DOMAIN_EVENTS.SUBSCRIPTION_ACTIVATED, handler);
    this.localTransport.on(DOMAIN_EVENTS.SUBSCRIPTION_EXPIRED, handler);
  }

  /**
   * Returns the full entitlements object for an organization.
   * Cache-first: checks Redis before hitting the database.
   */
  async getEntitlements(orgId: string): Promise<OrganizationEntitlements> {
    const cacheKey = `${this.cacheKeyPrefix}${orgId}`;
    const cached = await this.cache.get<OrganizationEntitlements>(cacheKey);
    if (cached) {
      return cached;
    }

    const org = await this.billingService.getOrgBillingStatus(orgId);

    const billingStatus = org?.billingStatus ?? BillingStatus.NONE;
    const isActive = billingStatus === BillingStatus.ACTIVE;
    const tier: PlanTier = isActive
      ? this.resolvePlanTier(org?.planId ?? null)
      : 'FREE';

    // Apply per-org admin overrides on top of plan defaults.
    // Overrides are stored in EntitlementOverride table and layered at read time.
    // Expired overrides (expiresAt < now) are ignored.
    const activeOverrides =
      await this.overrideRepository.findActiveByOrg(orgId);

    const overridePatch: Record<string, boolean | number> = {};
    for (const override of activeOverrides) {
      try {
        overridePatch[override.key] = JSON.parse(override.value) as
          | boolean
          | number;
      } catch {
        this.logger.warn(
          `Failed to parse override value for key '${override.key}' on org ${orgId}`,
        );
      }
    }

    const entitlements: OrganizationEntitlements = {
      organizationId: orgId,
      plan: tier,
      subscriptionStatus: billingStatus,
      ...PLAN_ENTITLEMENTS[tier],
      ...overridePatch,
    };

    await this.cache.set(cacheKey, entitlements, this.cacheTtl);

    return entitlements;
  }

  /**
   * Directly writes entitlements into the Redis cache.
   * Useful for tests or manual overrides without touching the database.
   */
  async setEntitlements(
    orgId: string,
    entitlements: OrganizationEntitlements,
  ): Promise<void> {
    const cacheKey = `${this.cacheKeyPrefix}${orgId}`;
    await this.cache.set(cacheKey, entitlements, this.cacheTtl);
  }

  /**
   * Returns true if the given boolean feature flag is enabled for the organization.
   */
  async checkFeature(
    orgId: string,
    featureKey: keyof PlanEntitlements,
  ): Promise<boolean> {
    const entitlements = await this.getEntitlements(orgId);
    const value = entitlements[featureKey];
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return (value as number) > 0;
    return false;
  }

  /**
   * Checks whether creating a new resource would stay within the plan's limit.
   *
   * @param orgId        - Organization UUID
   * @param limitKey     - Which limit to check (maxTeams | maxPlayers | maxCoaches)
   * @param currentCount - Number of existing resources of this type in the org
   */
  async checkLimit(
    orgId: string,
    limitKey: LimitKey,
    currentCount: number,
  ): Promise<{ allowed: boolean; limit: number; current: number }> {
    const entitlements = await this.getEntitlements(orgId);
    const tier =
      entitlements.plan in PLAN_LIMITS
        ? (entitlements.plan as PlanTier)
        : 'FREE';
    const limit = PLAN_LIMITS[tier][limitKey];
    return { allowed: currentCount < limit, limit, current: currentCount };
  }

  /**
   * Returns the maximum number of members allowed for an organization's plan.
   * Delegates to getEntitlements() so the result benefits from Redis caching.
   */
  async getMaxSeats(orgId: string): Promise<number> {
    const entitlements = await this.getEntitlements(orgId);
    return entitlements.maxSeats;
  }

  /**
   * Removes the cached entitlements for an organization, forcing a DB refresh
   * on the next call to getEntitlements().
   */
  async invalidateEntitlements(orgId: string): Promise<void> {
    const cacheKey = `${this.cacheKeyPrefix}${orgId}`;
    await this.cache.del(cacheKey);
  }

  /**
   * Returns all override records (including expired) for an organization.
   * The raw DB values are parsed from JSON strings to boolean | number.
   */
  async listOverrides(orgId: string): Promise<EntitlementOverrideRecord[]> {
    const rows = await this.overrideRepository.findAllByOrg(orgId);
    return rows.map((r) => ({
      ...r,
      value: JSON.parse(r.value) as boolean | number,
    }));
  }

  /**
   * Creates or updates a single entitlement override for an organization.
   * Invalidates the entitlements cache so the change takes effect immediately.
   */
  async setOverride(
    orgId: string,
    params: SetOverrideParams,
  ): Promise<EntitlementOverrideRecord> {
    const row = await this.overrideRepository.upsert(orgId, {
      key: params.key,
      value: JSON.stringify(params.value),
      reason: params.reason,
      expiresAt: params.expiresAt ? new Date(params.expiresAt) : null,
      createdBy: params.createdBy ?? '',
    });
    await this.invalidateEntitlements(orgId);
    return { ...row, value: params.value };
  }

  /**
   * Removes a single entitlement override for an organization.
   * Throws NotFoundException if the key does not exist.
   * Invalidates the entitlements cache so the plan default is restored immediately.
   */
  async deleteOverride(orgId: string, key: string): Promise<void> {
    await this.overrideRepository.delete(orgId, key);
    await this.invalidateEntitlements(orgId);
  }

  /**
   * Maps a Stripe Price ID to an internal plan tier using environment variables.
   *
   * STRIPE_PRICE_ID_PRO   → PRO tier
   * STRIPE_PRICE_ID_ENTERPRISE → ENTERPRISE tier
   * unknown / null        → FREE tier
   */
  private resolvePlanTier(planId: string | null): PlanTier {
    if (!planId) return 'FREE';
    if (planId === process.env['STRIPE_PRICE_ID_PRO']) return 'PRO';
    if (planId === process.env['STRIPE_PRICE_ID_ENTERPRISE'])
      return 'ENTERPRISE';
    return 'FREE';
  }
}
