import { Module, forwardRef } from '@nestjs/common';
import { RBACService } from './services/rbac.service';
import { RBACCacheService } from './services/rbac-cache.service';
import { PermissionResolverService } from './services/permission-resolver.service';
import { OrgContextGuard } from './guards/org-context.guard';
import { RBACGuard } from './guards/rbac.guard';
import { PrismaModule } from '../../prisma/prisma.module';
import { RedisModule } from '../../redis/redis.module';
import { MembershipsModule } from '../memberships/memberships.module';

@Module({
  imports: [PrismaModule, RedisModule, forwardRef(() => MembershipsModule)],
  providers: [RBACService, RBACCacheService, PermissionResolverService, OrgContextGuard, RBACGuard],
  exports: [RBACService, RBACCacheService, PermissionResolverService, OrgContextGuard, RBACGuard],
})
export class RBACModule {}
