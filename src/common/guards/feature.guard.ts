import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { FeatureFlagsService } from '../../modules/feature-flags/feature-flags.service';
import { PlanEntitlements } from '../../modules/feature-flags/interfaces/entitlements.interface';
import { RequestWithOrg } from './org-scope.guard';

export const FEATURE_KEY = 'feature';
export const RequireFeature = (feature: keyof PlanEntitlements) =>
  SetMetadata(FEATURE_KEY, feature);

@Injectable()
export class FeatureGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly featureFlagsService: FeatureFlagsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredFeature = this.reflector.getAllAndOverride<keyof PlanEntitlements>(FEATURE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredFeature) {
      return true;
    }

    const request = context.switchToHttp().getRequest<RequestWithOrg>();
    const orgId = request.orgId;

    if (!orgId) {
      throw new ForbiddenException('Organization context not found');
    }

    const hasFeature = await this.featureFlagsService.checkFeature(orgId, requiredFeature);

    if (!hasFeature) {
      throw new ForbiddenException(
        `Feature '${requiredFeature}' is not available in your current plan`,
      );
    }

    return true;
  }
}
