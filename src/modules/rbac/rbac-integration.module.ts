import { Module } from '@nestjs/common';
import { RBACModule } from '../rbac/rbac.module';
import { MembershipsModule } from '../memberships/memberships.module';
import { RBACCacheService } from '../rbac/services/rbac-cache.service';
import { MembershipsService } from '../memberships/memberships.service';

/**
 * Integration module to wire RBAC cache invalidation with MembershipsService
 */
@Module({
  imports: [RBACModule, MembershipsModule],
})
export class RBACIntegrationModule {
  constructor(
    private readonly rbacCache: RBACCacheService,
    private readonly memberships: MembershipsService,
  ) {
    // Wire cache service into memberships for auto-invalidation
    this.memberships.setRBACCacheService(this.rbacCache);
  }
}
