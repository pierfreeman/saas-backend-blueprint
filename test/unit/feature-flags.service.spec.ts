import { Test, TestingModule } from '@nestjs/testing';
import { FeatureFlagsService } from '../../src/modules/feature-flags/feature-flags.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { RedisService } from '../../src/redis/redis.service';
import { SubscriptionPlan, SubscriptionStatus } from '@prisma/client';
import { OrganizationEntitlements } from '../../src/modules/feature-flags/interfaces/entitlements.interface';

describe('FeatureFlagsService', () => {
  let service: FeatureFlagsService;
  let prismaService: any;
  let redisService: any;

  const mockOrgId = 'org-123';

  const mockFreeEntitlements: OrganizationEntitlements = {
    organizationId: mockOrgId,
    plan: 'FREE',
    subscriptionStatus: 'ACTIVE',
    maxTeams: 2,
    maxPlayers: 20,
    maxCoaches: 2,
    advancedAnalytics: false,
    customReports: false,
    apiAccess: false,
    ssoEnabled: false,
    prioritySupport: false,
  };

  const mockProEntitlements: OrganizationEntitlements = {
    organizationId: mockOrgId,
    plan: 'PRO',
    subscriptionStatus: 'ACTIVE',
    maxTeams: 10,
    maxPlayers: 200,
    maxCoaches: 10,
    advancedAnalytics: true,
    customReports: true,
    apiAccess: true,
    ssoEnabled: false,
    prioritySupport: false,
  };

  const mockEnterpriseEntitlements: OrganizationEntitlements = {
    organizationId: mockOrgId,
    plan: 'ENTERPRISE',
    subscriptionStatus: 'ACTIVE',
    maxTeams: 999999,
    maxPlayers: 999999,
    maxCoaches: 999999,
    advancedAnalytics: true,
    customReports: true,
    apiAccess: true,
    ssoEnabled: true,
    prioritySupport: true,
  };

  beforeEach(async () => {
    const mockPrisma = {
      subscription: {
        findUnique: jest.fn(),
      },
    } as any;

    const mockRedis = {
      get: jest.fn(),
      set: jest.fn(),
      del: jest.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FeatureFlagsService,
        {
          provide: PrismaService,
          useValue: mockPrisma,
        },
        {
          provide: RedisService,
          useValue: mockRedis,
        },
      ],
    }).compile();

    service = module.get<FeatureFlagsService>(FeatureFlagsService);
    prismaService = module.get(PrismaService);
    redisService = module.get(RedisService);
  });

  describe('getEntitlements', () => {
    it('should return cached entitlements when available', async () => {
      const cachedData = JSON.stringify(mockProEntitlements);
      redisService.get.mockResolvedValue(cachedData);

      const result = await service.getEntitlements(mockOrgId);

      expect(result).toEqual(mockProEntitlements);
      expect(redisService.get).toHaveBeenCalledWith(`entitlements:${mockOrgId}`);
      expect(prismaService.subscription.findUnique).not.toHaveBeenCalled();
    });

    it('should calculate and cache entitlements on cache miss', async () => {
      redisService.get.mockResolvedValue(null);
      prismaService.subscription.findUnique.mockResolvedValue({
        id: 'sub-123',
        orgId: mockOrgId,
        stripeSubscriptionId: 'sub_stripe_123',
        plan: SubscriptionPlan.PRO,
        status: SubscriptionStatus.ACTIVE,
        currentPeriodEnd: new Date(),
        cancelAtPeriodEnd: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await service.getEntitlements(mockOrgId);

      expect(result).toEqual(mockProEntitlements);
      expect(prismaService.subscription.findUnique).toHaveBeenCalledWith({
        where: { orgId: mockOrgId },
      });
      expect(redisService.set).toHaveBeenCalledWith(
        `entitlements:${mockOrgId}`,
        JSON.stringify(mockProEntitlements),
        10, // FEATURE_FLAGS_CACHE_TTL from .env.test
      );
    });

    it('should return FREE entitlements when no subscription exists', async () => {
      redisService.get.mockResolvedValue(null);
      prismaService.subscription.findUnique.mockResolvedValue(null);

      const result = await service.getEntitlements(mockOrgId);

      expect(result).toEqual(mockFreeEntitlements);
    });

    it('should return FREE entitlements when subscription is not active', async () => {
      redisService.get.mockResolvedValue(null);
      prismaService.subscription.findUnique.mockResolvedValue({
        id: 'sub-123',
        orgId: mockOrgId,
        stripeSubscriptionId: 'sub_stripe_123',
        plan: SubscriptionPlan.PRO,
        status: SubscriptionStatus.CANCELED,
        currentPeriodEnd: new Date(),
        cancelAtPeriodEnd: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await service.getEntitlements(mockOrgId);

      expect(result).toEqual({
        ...mockFreeEntitlements,
        subscriptionStatus: 'CANCELED',
      });
    });

    it('should return ENTERPRISE entitlements for enterprise plan', async () => {
      redisService.get.mockResolvedValue(null);
      prismaService.subscription.findUnique.mockResolvedValue({
        id: 'sub-123',
        orgId: mockOrgId,
        stripeSubscriptionId: 'sub_stripe_123',
        plan: SubscriptionPlan.ENTERPRISE,
        status: SubscriptionStatus.ACTIVE,
        currentPeriodEnd: new Date(),
        cancelAtPeriodEnd: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await service.getEntitlements(mockOrgId);

      expect(result).toEqual(mockEnterpriseEntitlements);
    });
  });

  describe('checkFeature', () => {
    it('should return true for enabled boolean features', async () => {
      redisService.get.mockResolvedValue(JSON.stringify(mockProEntitlements));

      const result = await service.checkFeature(mockOrgId, 'advancedAnalytics');

      expect(result).toBe(true);
    });

    it('should return false for disabled boolean features', async () => {
      redisService.get.mockResolvedValue(JSON.stringify(mockFreeEntitlements));

      const result = await service.checkFeature(mockOrgId, 'apiAccess');

      expect(result).toBe(false);
    });

    it('should return true for positive number limits', async () => {
      redisService.get.mockResolvedValue(JSON.stringify(mockProEntitlements));

      const result = await service.checkFeature(mockOrgId, 'maxTeams');

      expect(result).toBe(true);
    });
  });

  describe('checkLimit', () => {
    it('should return allowed when under limit', async () => {
      redisService.get.mockResolvedValue(JSON.stringify(mockProEntitlements));

      const result = await service.checkLimit(mockOrgId, 'maxTeams', 5);

      expect(result).toEqual({
        allowed: true,
        limit: 10,
        current: 5,
      });
    });

    it('should return not allowed when at or over limit', async () => {
      redisService.get.mockResolvedValue(JSON.stringify(mockProEntitlements));

      const result = await service.checkLimit(mockOrgId, 'maxTeams', 10);

      expect(result).toEqual({
        allowed: false,
        limit: 10,
        current: 10,
      });
    });

    it('should handle unlimited (999999) limits', async () => {
      redisService.get.mockResolvedValue(JSON.stringify(mockEnterpriseEntitlements));

      const result = await service.checkLimit(mockOrgId, 'maxTeams', 9999);

      expect(result).toEqual({
        allowed: true,
        limit: 999999,
        current: 9999,
      });
    });
  });

  describe('invalidateEntitlements', () => {
    it('should delete cache entry', async () => {
      await service.invalidateEntitlements(mockOrgId);

      expect(redisService.del).toHaveBeenCalledWith(`entitlements:${mockOrgId}`);
    });
  });

  describe('handleSubscriptionUpdated', () => {
    it('should invalidate cache when subscription updated', async () => {
      const event = {
        eventType: 'subscription.updated' as const,
        timestamp: new Date(),
        organizationId: mockOrgId,
        userId: 'user-123',
        payload: {},
      };

      await service.handleSubscriptionUpdated(event);

      expect(redisService.del).toHaveBeenCalledWith(`entitlements:${mockOrgId}`);
    });

    it('should not invalidate when no organizationId in event', async () => {
      const event = {
        eventType: 'subscription.updated' as const,
        timestamp: new Date(),
        userId: 'user-123',
        payload: {},
      };

      await service.handleSubscriptionUpdated(event);

      expect(redisService.del).not.toHaveBeenCalled();
    });
  });
});
