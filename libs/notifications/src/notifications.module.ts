import { Module } from '@nestjs/common';
import { ActivityLogModule } from '@libs/activity-log';
import { LegalAuditModule } from '@libs/legal-audit';
import { PrismaBusinessModule } from '@libs/prisma-business';
import { RedisModule } from '@libs/redis';
import { NotificationsService } from './application/services/notifications.service';
import { NotificationsPubSubService } from './application/services/notifications-pubsub.service';
import { NotificationsRepository } from './infrastructure/repositories/notifications.repository';
import { NotificationsGateway } from './realtime/gateway/notifications.gateway';
import { WsJwtGuard } from './realtime/guards/ws-jwt.guard';

/**
 * NotificationsModule
 *
 * Wires together the core in-app notification system:
 *   - WebSocket gateway — realtime delivery (`/notifications` namespace).
 *   - PubSub service   — Redis pub/sub transport.
 *   - Service          — business logic + cache management.
 *
 * The HTTP controller lives in `apps/api/src/app/notifications/` and is
 * registered via `NotificationsAppModule`, following the same pattern used
 * by `BillingAppModule`.
 *
 * Imports:
 *   - PrismaBusinessModule — DB access (notification records + user/membership lookup).
 *   - RedisModule          — CacheService for the unread counter.
 *
 * Exports:
 *   - NotificationsService — allows other modules to create / query notifications.
 *   - NotificationsGateway — allows other modules to push realtime events.
 */
@Module({
  imports: [ActivityLogModule, LegalAuditModule, PrismaBusinessModule, RedisModule],
  providers: [
    NotificationsRepository,
    NotificationsService,
    NotificationsPubSubService,
    NotificationsGateway,
    WsJwtGuard,
  ],
  exports: [NotificationsService, NotificationsGateway],
})
export class NotificationsModule {}
