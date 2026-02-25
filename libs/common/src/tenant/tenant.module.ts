import { Module } from '@nestjs/common';
import { TenantContextService } from './tenant-context.service';

/**
 * TenantModule
 *
 * Provides the REQUEST-scoped TenantContextService.
 * Import this module in any feature module that needs to inject TenantContextService.
 *
 * Usage in a feature module:
 *   @Module({ imports: [TenantModule], ... })
 *   export class TasksModule {}
 */
@Module({
  providers: [TenantContextService],
  exports: [TenantContextService],
})
export class TenantModule {}
