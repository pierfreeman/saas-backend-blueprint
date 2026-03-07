import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { FeatureGuard, FEATURE_KEY } from './feature.guard';
import { FeatureFlagsService } from '../feature-flags.service';
import { RequestWithOrgContext } from '../../rbac/guards/org-context.guard';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const ORG_ID = 'org-uuid-001';

function makeContext(
  request: Partial<RequestWithOrgContext>,
  metadata?: string,
): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;
}

// ─── Suite ───────────────────────────────────────────────────────────────────

describe('FeatureGuard', () => {
  let guard: FeatureGuard;
  let reflector: jest.Mocked<Reflector>;
  let featureFlagsService: jest.Mocked<FeatureFlagsService>;

  beforeEach(() => {
    reflector = {
      getAllAndOverride: jest.fn(),
    } as unknown as jest.Mocked<Reflector>;

    featureFlagsService = {
      checkFeature: jest.fn(),
    } as unknown as jest.Mocked<FeatureFlagsService>;

    guard = new FeatureGuard(reflector, featureFlagsService);
    jest.clearAllMocks();
  });

  // ─── No metadata ──────────────────────────────────────────────────────────

  it('passes when no @RequireFeature metadata is present on the route', async () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);
    const ctx = makeContext({ orgId: ORG_ID });

    expect(await guard.canActivate(ctx)).toBe(true);
    expect(featureFlagsService.checkFeature).not.toHaveBeenCalled();
  });

  // ─── Missing orgId ────────────────────────────────────────────────────────

  it('throws ForbiddenException when orgId is missing from the request', async () => {
    reflector.getAllAndOverride.mockReturnValue('advancedAnalytics');
    const ctx = makeContext({ orgId: undefined });

    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
    expect(featureFlagsService.checkFeature).not.toHaveBeenCalled();
  });

  // ─── Feature check ────────────────────────────────────────────────────────

  it('passes when checkFeature returns true for the required feature', async () => {
    reflector.getAllAndOverride.mockReturnValue('advancedAnalytics');
    featureFlagsService.checkFeature.mockResolvedValue(true);
    const ctx = makeContext({ orgId: ORG_ID });

    expect(await guard.canActivate(ctx)).toBe(true);
    expect(featureFlagsService.checkFeature).toHaveBeenCalledWith(
      ORG_ID,
      'advancedAnalytics',
    );
  });

  it('throws ForbiddenException when checkFeature returns false', async () => {
    reflector.getAllAndOverride.mockReturnValue('ssoEnabled');
    featureFlagsService.checkFeature.mockResolvedValue(false);
    const ctx = makeContext({ orgId: ORG_ID });

    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
    await expect(guard.canActivate(ctx)).rejects.toThrow(
      "Feature 'ssoEnabled' is not available in your current plan",
    );
  });

  it('reads metadata from both handler and class (getAllAndOverride)', async () => {
    reflector.getAllAndOverride.mockReturnValue('customReports');
    featureFlagsService.checkFeature.mockResolvedValue(true);
    const ctx = makeContext({ orgId: ORG_ID });

    await guard.canActivate(ctx);

    expect(reflector.getAllAndOverride).toHaveBeenCalledWith(FEATURE_KEY, [
      expect.anything(), // handler
      expect.anything(), // class
    ]);
  });

  it('propagates errors thrown by FeatureFlagsService', async () => {
    reflector.getAllAndOverride.mockReturnValue('apiAccess');
    featureFlagsService.checkFeature.mockRejectedValue(
      new Error('Cache failure'),
    );
    const ctx = makeContext({ orgId: ORG_ID });

    await expect(guard.canActivate(ctx)).rejects.toThrow('Cache failure');
  });
});
