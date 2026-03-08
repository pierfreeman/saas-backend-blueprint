import { Module } from '@nestjs/common';
import { NotificationsModule } from '@libs/notifications';
import { AuthModule } from '../auth/auth.module';
import { NotificationsController } from './notifications.controller';

/**
 * NotificationsAppModule
 *
 * HTTP layer for the in-app notification feature in the api application.
 *
 * Mounts NotificationsController and delegates all business logic to the
 * services exported from the shared NotificationsModule.
 *
 * Mirrors the pattern used by BillingAppModule:
 *   - libs/notifications    → shared services, gateway, pub/sub (no controllers)
 *   - NotificationsAppModule → HTTP controller wired to real guards
 */
@Module({
  imports: [NotificationsModule, AuthModule],
  controllers: [NotificationsController],
})
export class NotificationsAppModule {}
