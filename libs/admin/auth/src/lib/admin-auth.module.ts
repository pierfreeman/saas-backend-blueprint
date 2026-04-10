import { Module } from '@nestjs/common';
import { AdminIdentityModule } from '@libs/admin/identity';
import { AdminJwtAuthGuard } from './guards/admin-jwt-auth.guard';

/**
 * AdminAuthModule
 *
 * Provides authentication guards for admin-api controllers via the
 * new Admin-Users-DB Auth0 pipeline: `@UseGuards(AdminJwtAuthGuard)`
 *
 * The AdminJwtStrategy is registered via AdminIdentityModule.
 */
@Module({
  imports: [AdminIdentityModule],
  providers: [AdminJwtAuthGuard],
  exports: [AdminJwtAuthGuard, AdminIdentityModule],
})
export class AdminAuthModule {}
