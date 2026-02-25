import { Module } from '@nestjs/common';
import { PrismaModule } from '@libs/prisma';
import { RedisModule } from '@libs/redis';
import { RBACService } from './services/rbac.service';
import { RBACCacheService } from './services/rbac-cache.service';
import { PermissionResolverService } from './services/permission-resolver.service';
import { OrgContextGuard } from './guards/org-context.guard';
import { RBACGuard } from './guards/rbac.guard';

@Module({
  imports: [PrismaModule, RedisModule],
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
