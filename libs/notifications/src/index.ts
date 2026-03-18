// Types & constants
export * from './types/notification.types';

// WebSocket payload DTOs (runtime type safety + Swagger schema reflection)
export * from './realtime/dto/ws-payloads.dto';

// Infrastructure services (DB + Redis)
export { NotificationsService } from './infrastructure/notifications.service';
export { NotificationsPubSubService } from './infrastructure/notifications-pubsub.service';

// Realtime
export { NotificationsGateway } from './realtime/gateway/notifications.gateway';
export { WsJwtGuard } from './realtime/guards/ws-jwt.guard';

// Module (core — no HTTP controller)
export { NotificationsModule } from './notifications.module';
