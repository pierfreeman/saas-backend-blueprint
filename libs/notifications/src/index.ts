// Types & constants
export * from './types/notification.types';

// WebSocket payload DTOs (runtime type safety + Swagger schema reflection)
export * from './realtime/dto/ws-payloads.dto';

// Data-access services
export { NotificationsService } from './data-access/notifications.service';
export { NotificationsPubSubService } from './data-access/notifications-pubsub.service';

// Realtime
export { NotificationsGateway } from './realtime/gateway/notifications.gateway';
export { WsJwtGuard } from './realtime/guards/ws-jwt.guard';

// Module (core — no HTTP controller)
export { NotificationsModule } from './api/notifications.module';
