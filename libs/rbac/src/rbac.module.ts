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
import { TenantContextInterceptor } from './interceptors/tenant-context.interceptor';
import { TenantContextMiddleware } from './middleware/tenant-context.middleware';

@Module({
  imports: [MembershipsModule, UsersModule, OrganizationsModule, RedisModule],
  providers: [
    RBACService,
    RBACCacheService,
    PermissionResolverService,
    OrgContextGuard,
    RBACGuard,
    TenantContextInterceptor,
    TenantContextMiddleware,
  ],
  exports: [
    // Re-export the dependency modules so that OrgContextGuard's constructor
    // dependencies (UsersService, MembershipsService, OrganizationsService)
    // are available in the merged injector of any module that imports RBACModule.
    UsersModule,
    MembershipsModule,
    OrganizationsModule,
    RBACService,
    RBACCacheService,
    PermissionResolverService,
    OrgContextGuard,
    RBACGuard,
    TenantContextInterceptor,
    TenantContextMiddleware,
  ],
})
export class RBACModule {}
