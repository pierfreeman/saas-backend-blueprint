import { Test, TestingModule } from '@nestjs/testing';
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { FeatureGuard, FEATURE_KEY } from '../../src/common/guards/feature.guard';
import { FeatureFlagsService } from '../../src/modules/feature-flags/feature-flags.service';

describe('FeatureGuard', () => {
  let guard: FeatureGuard;
  let reflector: any;
  let featureFlagsService: any;

  beforeEach(async () => {
    const mockReflector = {
      getAllAndOverride: jest.fn(),
    };

    const mockFeatureFlagsService = {
      checkFeature: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FeatureGuard,
        { provide: Reflector, useValue: mockReflector },
        { provide: FeatureFlagsService, useValue: mockFeatureFlagsService },
      ],
    }).compile();

    guard = module.get<FeatureGuard>(FeatureGuard);
    reflector = module.get(Reflector);
    featureFlagsService = module.get(FeatureFlagsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  const createMockContext = (orgId?: string): ExecutionContext => {
    return {
      switchToHttp: () => ({
        getRequest: () => ({
          orgId,
        }),
      }),
      getHandler: jest.fn(),
      getClass: jest.fn(),
    } as any;
  };

  describe('canActivate', () => {
    it('should allow access when no feature is required', async () => {
      reflector.getAllAndOverride.mockReturnValue(null);
      const context = createMockContext();

      const result = await guard.canActivate(context);

      expect(result).toBe(true);
      expect(reflector.getAllAndOverride).toHaveBeenCalledWith(FEATURE_KEY, [
        context.getHandler(),
        context.getClass(),
      ]);
    });

    it('should throw ForbiddenException when orgId not found', async () => {
      reflector.getAllAndOverride.mockReturnValue('apiAccess');
      const context = createMockContext(undefined);

      await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
      await expect(guard.canActivate(context)).rejects.toThrow('Organization context not found');
    });

    it('should allow access when organization has required feature', async () => {
      reflector.getAllAndOverride.mockReturnValue('apiAccess');
      const context = createMockContext('org-123');

      featureFlagsService.checkFeature.mockResolvedValue(true);

      const result = await guard.canActivate(context);

      expect(result).toBe(true);
      expect(featureFlagsService.checkFeature).toHaveBeenCalledWith('org-123', 'apiAccess');
    });

    it('should deny access when organization does not have required feature', async () => {
      reflector.getAllAndOverride.mockReturnValue('apiAccess');
      const context = createMockContext('org-123');

      featureFlagsService.checkFeature.mockResolvedValue(false);

      await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
      await expect(guard.canActivate(context)).rejects.toThrow(
        "Feature 'apiAccess' is not available in your current plan",
      );
      expect(featureFlagsService.checkFeature).toHaveBeenCalledWith('org-123', 'apiAccess');
    });

    it('should check maxPlayers feature', async () => {
      reflector.getAllAndOverride.mockReturnValue('maxPlayers');
      const context = createMockContext('org-456');

      featureFlagsService.checkFeature.mockResolvedValue(true);

      const result = await guard.canActivate(context);

      expect(result).toBe(true);
      expect(featureFlagsService.checkFeature).toHaveBeenCalledWith('org-456', 'maxPlayers');
    });

    it('should check maxTeams feature', async () => {
      reflector.getAllAndOverride.mockReturnValue('maxTeams');
      const context = createMockContext('org-789');

      featureFlagsService.checkFeature.mockResolvedValue(true);

      const result = await guard.canActivate(context);

      expect(result).toBe(true);
      expect(featureFlagsService.checkFeature).toHaveBeenCalledWith('org-789', 'maxTeams');
    });

    it('should check support feature', async () => {
      reflector.getAllAndOverride.mockReturnValue('support');
      const context = createMockContext('org-premium');

      featureFlagsService.checkFeature.mockResolvedValue(true);

      const result = await guard.canActivate(context);

      expect(result).toBe(true);
      expect(featureFlagsService.checkFeature).toHaveBeenCalledWith('org-premium', 'support');
    });

    it('should deny access for free plan requesting pro feature', async () => {
      reflector.getAllAndOverride.mockReturnValue('apiAccess');
      const context = createMockContext('org-free');

      featureFlagsService.checkFeature.mockResolvedValue(false);

      await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
      await expect(guard.canActivate(context)).rejects.toThrow(
        "Feature 'apiAccess' is not available in your current plan",
      );
    });

    it('should handle multiple organizations with different features', async () => {
      reflector.getAllAndOverride.mockReturnValue('apiAccess');

      // First org has feature
      const context1 = createMockContext('org-pro');
      featureFlagsService.checkFeature.mockResolvedValue(true);
      const result1 = await guard.canActivate(context1);
      expect(result1).toBe(true);

      // Second org does not have feature
      const context2 = createMockContext('org-free');
      featureFlagsService.checkFeature.mockResolvedValue(false);
      await expect(guard.canActivate(context2)).rejects.toThrow(ForbiddenException);
    });

    it('should handle feature check errors', async () => {
      reflector.getAllAndOverride.mockReturnValue('apiAccess');
      const context = createMockContext('org-123');

      featureFlagsService.checkFeature.mockRejectedValue(new Error('Database error'));

      await expect(guard.canActivate(context)).rejects.toThrow('Database error');
    });
  });
});
