import { Injectable } from '@nestjs/common';
import {
  FeatureFlagsService,
  OrganizationEntitlements,
} from '@libs/feature-flags';

@Injectable()
export class AdminEntitlementsService {
  constructor(private readonly featureFlagsService: FeatureFlagsService) {}

  getEntitlements(orgId: string): Promise<OrganizationEntitlements> {
    return this.featureFlagsService.getEntitlements(orgId);
  }

  invalidateCache(orgId: string): Promise<void> {
    return this.featureFlagsService.invalidateEntitlements(orgId);
  }
}
