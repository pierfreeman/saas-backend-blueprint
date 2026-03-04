import { Module } from '@nestjs/common';
import { PrismaBusinessModule } from '@libs/prisma-business';
import { RedisModule } from '@libs/redis';
import { RBACService } from './services/rbac.service';
import { RBACCacheService } from './services/rbac-cache.service';
import { PermissionResolverService } from './services/permission-resolver.service';
import { OrgContextGuard } from './guards/org-context.guard';
import { RBACGuard } from './guards/rbac.guard';

@Module({
  imports: [PrismaBusinessModule, RedisModule],
  providers: [
    RBACService,
    RBACCacheService,
    PermissionResolverService,
    OrgContextGuard,
    RBACGuard,
  ],
  exports: [
    PrismaBusinessModule,
    RBACService,
    RBACCacheService,
    PermissionResolverService,
    OrgContextGuard,
    RBACGuard,
  ],
})
export class RBACModule {}
