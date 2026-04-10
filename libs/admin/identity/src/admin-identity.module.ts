import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { PrismaLegalModule } from '@libs/prisma-legal';
import { AdminUserRepository } from './infrastructure/repositories/admin-user.repository';
import { AdminIdentityService } from './application/services/admin-identity.service';
import { AdminJwtStrategy } from './infrastructure/strategies/admin-jwt.strategy';

/**
 * AdminIdentityModule
 *
 * Pattern B (2-layer) library for the AdminUser aggregate.
 *
 * Provides:
 * - AdminIdentityService — public API (sync/lookup admin users)
 * - AdminJwtStrategy    — Passport 'admin-jwt' strategy (wired here, used by AdminJwtAuthGuard)
 *
 * Import this module in AdminAuthModule so the strategy is registered.
 * ConfigModule must be globally available (provided in AdminApiAppModule).
 */
@Module({
  imports: [PrismaLegalModule, PassportModule],
  providers: [AdminUserRepository, AdminIdentityService, AdminJwtStrategy],
  exports: [AdminIdentityService],
})
export class AdminIdentityModule {}
