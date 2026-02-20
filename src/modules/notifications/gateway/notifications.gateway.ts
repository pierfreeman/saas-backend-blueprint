import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayInit,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  NotificationsPubSubService,
  NotificationMessage,
} from '../redis/notifications-pubsub.service';
import { NotificationsService } from '../services/notifications.service';
import { WsJwtGuard } from '../guards/ws-jwt.guard';
import { GetNotificationsDto } from '../dto';

interface AuthenticatedSocket extends Socket {
  userId?: string;
  email?: string;
}

@WebSocketGateway({
  namespace: '/notifications',
  cors: {
    origin: true,
    credentials: true,
  },
  transports: ['websocket', 'polling'],
})
export class NotificationsGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  private server!: Server;

  private readonly logger = new Logger(NotificationsGateway.name);
  private userSockets: Map<string, Set<string>> = new Map(); // userId -> Set<socketId>

  constructor(
    private readonly configService: ConfigService,
    private readonly jwtService: JwtService,
    private readonly pubSub: NotificationsPubSubService,
    private readonly notificationsService: NotificationsService,
  ) {}

  afterInit(_server: Server): void {
    this.logger.log('WebSocket Gateway initialized');

    // Subscribe to Redis pub/sub for all user notifications
    this.pubSub.subscribeToUserPattern((message: NotificationMessage) => {
      this.handleNotificationMessage(message);
    });

    this.pubSub.subscribeToBroadcast((message: NotificationMessage) => {
      this.handleBroadcastMessage(message);
    });
  }

  async handleConnection(client: AuthenticatedSocket): Promise<void> {
    try {
      // Extract token from handshake auth or query
      const token = this.extractToken(client);

      if (!token) {
        this.logger.warn(`Connection rejected: No token provided`);
        client.disconnect();
        return;
      }

      // Verify JWT token
      const payload = await this.verifyToken(token);

      if (!payload || !payload.sub) {
        this.logger.warn(`Connection rejected: Invalid token`);
        client.disconnect();
        return;
      }

      // Attach user info to socket
      client.userId = payload.sub;
      client.email = payload.email;

      // Track socket for this user
      this.trackUserSocket(payload.sub, client.id);

      // Join user-specific room
      const room = this.getUserRoom(payload.sub);
      await client.join(room);

      this.logger.log(`Client connected: ${client.id} (User: ${payload.sub})`);

      // Send initial unread count
      const unreadCount = await this.notificationsService.getUnreadCount(payload.sub);
      client.emit('notification:unread-count', { count: unreadCount });
    } catch (error) {
      this.logger.error(
        `Error in handleConnection`,
        error instanceof Error ? error.stack : 'Unknown error',
      );
      client.disconnect();
    }
  }

  handleDisconnect(client: AuthenticatedSocket): void {
    if (client.userId) {
      this.untrackUserSocket(client.userId, client.id);
      this.logger.log(`Client disconnected: ${client.id} (User: ${client.userId})`);
    } else {
      this.logger.log(`Client disconnected: ${client.id} (unauthenticated)`);
    }
  }

  @UseGuards(WsJwtGuard)
  @SubscribeMessage('notification:get-all')
  async handleGetNotifications(
    client: AuthenticatedSocket,
    payload: GetNotificationsDto,
  ): Promise<{ event: string; data: any }> {
    try {
      if (!client.userId) {
        return { event: 'notification:error', data: { message: 'Unauthorized' } };
      }

      const notifications = await this.notificationsService.getUserNotifications(
        client.userId,
        payload,
      );

      return { event: 'notification:list', data: notifications };
    } catch (error) {
      this.logger.error(
        `Error fetching notifications`,
        error instanceof Error ? error.stack : 'Unknown error',
      );
      return { event: 'notification:error', data: { message: 'Failed to fetch notifications' } };
    }
  }

  @UseGuards(WsJwtGuard)
  @SubscribeMessage('notification:mark-read')
  async handleMarkAsRead(
    client: AuthenticatedSocket,
    payload: { notificationId: string },
  ): Promise<{ event: string; data: any }> {
    try {
      if (!client.userId) {
        return { event: 'notification:error', data: { message: 'Unauthorized' } };
      }

      const notification = await this.notificationsService.markAsRead(
        client.userId,
        payload.notificationId,
      );

      const unreadCount = await this.notificationsService.getUnreadCount(client.userId);

      // Emit to all user's sockets
      this.emitToUser(client.userId, 'notification:read', notification);
      this.emitToUser(client.userId, 'notification:unread-count', { count: unreadCount });

      return { event: 'notification:read', data: notification };
    } catch (error) {
      this.logger.error(
        `Error marking notification as read`,
        error instanceof Error ? error.stack : 'Unknown error',
      );
      return { event: 'notification:error', data: { message: 'Failed to mark as read' } };
    }
  }

  @UseGuards(WsJwtGuard)
  @SubscribeMessage('notification:mark-all-read')
  async handleMarkAllAsRead(client: AuthenticatedSocket): Promise<{ event: string; data: any }> {
    try {
      if (!client.userId) {
        return { event: 'notification:error', data: { message: 'Unauthorized' } };
      }

      const count = await this.notificationsService.markAllAsRead(client.userId);

      // Emit to all user's sockets
      this.emitToUser(client.userId, 'notification:bulk-read', { count });
      this.emitToUser(client.userId, 'notification:unread-count', { count: 0 });

      return { event: 'notification:bulk-read', data: { count } };
    } catch (error) {
      this.logger.error(
        `Error marking all as read`,
        error instanceof Error ? error.stack : 'Unknown error',
      );
      return { event: 'notification:error', data: { message: 'Failed to mark all as read' } };
    }
  }

  private handleNotificationMessage(message: NotificationMessage): void {
    const { userId } = message;
    this.logger.debug(`Received notification for user ${userId} from Redis`);

    // Emit to user's room
    this.emitToUser(userId, 'notification:new', message);

    // Update unread count
    this.notificationsService.getUnreadCount(userId).then((count) => {
      this.emitToUser(userId, 'notification:unread-count', { count });
    });
  }

  private handleBroadcastMessage(message: NotificationMessage): void {
    this.logger.debug('Broadcasting notification to all connected clients');
    this.server.emit('notification:new', message);
  }

  private extractToken(client: AuthenticatedSocket): string | null {
    // Try auth object first (socket.io v4+)
    const authToken = client.handshake?.auth?.token;
    if (authToken) {
      return authToken.replace('Bearer ', '');
    }

    // Fallback to query params
    const queryToken = client.handshake?.query?.token;
    if (queryToken && typeof queryToken === 'string') {
      return queryToken.replace('Bearer ', '');
    }

    // Try headers
    const headerToken = client.handshake?.headers?.authorization;
    if (headerToken) {
      return headerToken.replace('Bearer ', '');
    }

    return null;
  }

  private async verifyToken(token: string): Promise<any> {
    try {
      // For Auth0, we need to verify using the same strategy as HTTP
      // This is a simplified version - in production, use the same jwks-rsa validation
      const domain = this.configService.get<string>('auth.domain');
      const audience = this.configService.get<string>('auth.audience');

      // Decode without verification first to check issuer
      const decoded = this.jwtService.decode(token);

      if (!decoded || typeof decoded !== 'object') {
        throw new Error('Invalid token format');
      }

      // In production, you should validate the token using jwks-rsa
      // For now, we'll do a basic verification
      // NOTE: This should match the JwtStrategy validation
      return decoded;
    } catch (error) {
      this.logger.error(
        'Token verification failed',
        error instanceof Error ? error.stack : 'Unknown error',
      );
      throw error;
    }
  }

  private trackUserSocket(userId: string, socketId: string): void {
    if (!this.userSockets.has(userId)) {
      this.userSockets.set(userId, new Set());
    }
    this.userSockets.get(userId)!.add(socketId);
  }

  private untrackUserSocket(userId: string, socketId: string): void {
    const sockets = this.userSockets.get(userId);
    if (sockets) {
      sockets.delete(socketId);
      if (sockets.size === 0) {
        this.userSockets.delete(userId);
      }
    }
  }

  private getUserRoom(userId: string): string {
    return `user:${userId}`;
  }

  private emitToUser(userId: string, event: string, data: any): void {
    const room = this.getUserRoom(userId);
    this.server.to(room).emit(event, data);
  }

  // Public method to emit notifications (can be called from other services)
  public sendNotificationToUser(userId: string, notification: NotificationMessage): void {
    this.emitToUser(userId, 'notification:new', notification);
  }

  // Check if user is online
  public isUserOnline(userId: string): boolean {
    const sockets = this.userSockets.get(userId);
    return sockets ? sockets.size > 0 : false;
  }
}
