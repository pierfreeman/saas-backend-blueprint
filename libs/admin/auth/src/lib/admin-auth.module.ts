import { Module } from '@nestjs/common';
import { UsersModule } from '@libs/users';
import { SystemAdminGuard } from './guards/system-admin.guard';

/**
 * AdminAuthModule
 *
 * Provides the SystemAdminGuard and the CurrentAdminUserId decorator.
 * Import this module in any feature module that exposes admin controllers.
 *
 * Pipeline to apply on every admin controller:
 *   @UseGuards(JwtAuthGuard, SystemAdminGuard)
 */
@Module({
  imports: [UsersModule],
  providers: [SystemAdminGuard],
  exports: [SystemAdminGuard, UsersModule],
})
export class AdminAuthModule {}
