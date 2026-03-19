import { Module } from '@nestjs/common';
import { RedisModule } from '@libs/redis';
import { MembershipsModule } from '@libs/memberships';
import { UsersModule } from '@libs/users';
import { OrganizationsModule } from '@libs/organizations';
import { RBACService } from './services/rbac.service';
import { RBACCacheService } from './services/rbac-cache.service';
import { PermissionResolverService } from './services/permission-resolver.service';
import { OrgContextGuard } from './guards/org-context.guard';
import { RBACGuard } from './guards/rbac.guard';

@Module({
  imports: [MembershipsModule, UsersModule, OrganizationsModule, RedisModule],
  providers: [
    RBACService,
    RBACCacheService,
    PermissionResolverService,
    OrgContextGuard,
    RBACGuard,
  ],
  exports: [
    RBACService,
    RBACCacheService,
    PermissionResolverService,
    OrgContextGuard,
    RBACGuard,
  ],
})
export class RBACModule {}
