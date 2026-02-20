import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { SubscriptionPlan, SubscriptionStatus } from '@prisma/client';
import { PlanEntitlements, OrganizationEntitlements } from './interfaces/entitlements.interface';
import { DomainEvent } from '../../events/event-bus.service';

@Injectable()
export class FeatureFlagsService {
  private readonly logger = new Logger(FeatureFlagsService.name);
  private readonly CACHE_TTL = parseInt(process.env.FEATURE_FLAGS_CACHE_TTL || '600', 10);
  private readonly CACHE_KEY_PREFIX = 'entitlements:';

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async getEntitlements(orgId: string): Promise<OrganizationEntitlements> {
    // Try to get from cache first
    const cached = await this.getFromCache(orgId);
    if (cached) {
      this.logger.debug(`Cache hit for organization ${orgId}`);
      return cached;
    }

    // Calculate from database
    this.logger.debug(`Cache miss for organization ${orgId}, calculating...`);
    const entitlements = await this.calculateEntitlements(orgId);

    // Store in cache
    await this.setInCache(orgId, entitlements);

    return entitlements;
  }

  async setEntitlements(orgId: string, entitlements: OrganizationEntitlements): Promise<void> {
    await this.setInCache(orgId, entitlements);
    this.logger.log(`Entitlements set for organization ${orgId}`);
  }

  async checkFeature(orgId: string, featureKey: keyof PlanEntitlements): Promise<boolean> {
    const entitlements = await this.getEntitlements(orgId);

    const featureValue = entitlements[featureKey];

    if (typeof featureValue === 'boolean') {
      return featureValue;
    }

    if (typeof featureValue === 'number') {
      return featureValue > 0;
    }

    return false;
  }

  async checkLimit(
    orgId: string,
    limitKey: 'maxTeams' | 'maxPlayers' | 'maxCoaches',
    currentCount: number,
  ): Promise<{ allowed: boolean; limit: number; current: number }> {
    const entitlements = await this.getEntitlements(orgId);
    const limit = entitlements[limitKey];

    return {
      allowed: currentCount < limit,
      limit,
      current: currentCount,
    };
  }

  async invalidateEntitlements(orgId: string): Promise<void> {
    const key = this.getCacheKey(orgId);
    await this.redis.del(key);
    this.logger.log(`Cache invalidated for organization ${orgId}`);
  }

  @OnEvent('subscription.updated')
  async handleSubscriptionUpdated(event: DomainEvent): Promise<void> {
    const orgId = event.organizationId;
    if (!orgId) {
      return;
    }

    this.logger.log(`Subscription updated for organization ${orgId}, invalidating cache`);
    await this.invalidateEntitlements(orgId);
  }

  private async calculateEntitlements(orgId: string): Promise<OrganizationEntitlements> {
    const subscription = await this.prisma.subscription.findUnique({
      where: { orgId },
    });

    const plan = subscription?.plan || SubscriptionPlan.FREE;
    const status = subscription?.status || SubscriptionStatus.ACTIVE;

    const planEntitlements = this.getPlanEntitlements(plan);

    // If subscription is not active, downgrade to FREE
    const effectivePlan = status === SubscriptionStatus.ACTIVE ? plan : SubscriptionPlan.FREE;
    const effectiveEntitlements =
      effectivePlan === plan ? planEntitlements : this.getPlanEntitlements(SubscriptionPlan.FREE);

    return {
      organizationId: orgId,
      plan: effectivePlan,
      subscriptionStatus: status,
      ...effectiveEntitlements,
    };
  }

  private getPlanEntitlements(plan: SubscriptionPlan): PlanEntitlements {
    const entitlementsMap: Record<SubscriptionPlan, PlanEntitlements> = {
      [SubscriptionPlan.FREE]: {
        maxTeams: 2,
        maxPlayers: 20,
        maxCoaches: 2,
        advancedAnalytics: false,
        customReports: false,
        apiAccess: false,
        ssoEnabled: false,
        prioritySupport: false,
      },
      [SubscriptionPlan.PRO]: {
        maxTeams: 10,
        maxPlayers: 200,
        maxCoaches: 10,
        advancedAnalytics: true,
        customReports: true,
        apiAccess: true,
        ssoEnabled: false,
        prioritySupport: false,
      },
      [SubscriptionPlan.ENTERPRISE]: {
        maxTeams: 999999,
        maxPlayers: 999999,
        maxCoaches: 999999,
        advancedAnalytics: true,
        customReports: true,
        apiAccess: true,
        ssoEnabled: true,
        prioritySupport: true,
      },
    };

    return entitlementsMap[plan];
  }

  private getCacheKey(orgId: string): string {
    return `${this.CACHE_KEY_PREFIX}${orgId}`;
  }

  private async getFromCache(orgId: string): Promise<OrganizationEntitlements | null> {
    const key = this.getCacheKey(orgId);
    const cached = await this.redis.get(key);

    if (!cached) {
      return null;
    }

    try {
      return JSON.parse(cached) as OrganizationEntitlements;
    } catch (error) {
      this.logger.error(
        `Failed to parse cached entitlements for ${orgId}`,
        error instanceof Error ? error.stack : 'Unknown error',
      );
      return null;
    }
  }

  private async setInCache(orgId: string, entitlements: OrganizationEntitlements): Promise<void> {
    const key = this.getCacheKey(orgId);
    const value = JSON.stringify(entitlements);
    await this.redis.set(key, value, this.CACHE_TTL);
  }
}
