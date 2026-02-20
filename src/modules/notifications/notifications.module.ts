import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { NotificationsService } from './services/notifications.service';
import { NotificationsPubSubService } from './redis/notifications-pubsub.service';
import { NotificationsGateway } from './gateway/notifications.gateway';
import { NotificationsController } from './controllers/notifications.controller';
import { WsJwtGuard } from './guards/ws-jwt.guard';

@Module({
  imports: [JwtModule.register({})],
  controllers: [NotificationsController],
  providers: [NotificationsService, NotificationsPubSubService, NotificationsGateway, WsJwtGuard],
  exports: [NotificationsService, NotificationsGateway],
})
export class NotificationsModule {}
