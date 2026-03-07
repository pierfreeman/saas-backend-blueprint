import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { FeatureFlagsService } from '../feature-flags.service';
import { PlanEntitlements } from '../interfaces/entitlements.interface';
import { RequestWithOrgContext } from '../../rbac/guards/org-context.guard';

export const FEATURE_KEY = 'feature';

/**
 * RequireFeature decorator
 * Marks a route (or entire controller) as requiring a specific plan feature.
 * Must be combined with FeatureGuard and OrgContextGuard (which sets req.orgId).
 *
 * @example
 * ```typescript
 * @Get('reports')
 * @UseGuards(JwtAuthGuard, OrgContextGuard, FeatureGuard)
 * @RequireFeature('customReports')
 * async getReports(@Param('orgId') orgId: string) { ... }
 * ```
 */
export const RequireFeature = (feature: keyof PlanEntitlements) =>
  SetMetadata(FEATURE_KEY, feature);

/**
 * FeatureGuard
 * Reads the @RequireFeature() metadata from the route handler and checks
 * whether the organization's plan includes that feature.
 *
 * Guard pipeline position: after JwtAuthGuard and OrgContextGuard so that
 * req.orgId is already populated when this guard runs.
 */
@Injectable()
export class FeatureGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly featureFlagsService: FeatureFlagsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredFeature = this.reflector.getAllAndOverride<
      keyof PlanEntitlements
    >(FEATURE_KEY, [context.getHandler(), context.getClass()]);

    if (!requiredFeature) return true;

    const request = context.switchToHttp().getRequest<RequestWithOrgContext>();
    const orgId = request.orgId;

    if (!orgId) {
      throw new ForbiddenException('Organization context not found');
    }

    const hasFeature = await this.featureFlagsService.checkFeature(
      orgId,
      requiredFeature,
    );

    if (!hasFeature) {
      throw new ForbiddenException(
        `Feature '${requiredFeature}' is not available in your current plan`,
      );
    }

    return true;
  }
}
