import { Logger, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { createAdapter } from '@socket.io/redis-adapter';
import Redis from 'ioredis';
import * as jwt from 'jsonwebtoken';
import { JwksClient, SigningKey } from 'jwks-rsa';
import { Server, Socket } from 'socket.io';
import { NotificationsPubSubService } from '../../infrastructure/notifications-pubsub.service';
import { NotificationsRepository } from '../../infrastructure/repositories/notifications.repository';
import { NotificationsService } from '../../infrastructure/notifications.service';
import {
  NotificationMessage,
  RealtimeEvent,
} from '../../types/notification.types';
import { WsJwtGuard } from '../guards/ws-jwt.guard';

interface AuthenticatedSocket extends Socket {
  userId?: string;
  email?: string;
}

interface GetAllPayload {
  orgId?: string;
  limit?: number;
  offset?: number;
  unreadOnly?: boolean;
}

interface MarkReadPayload {
  notificationId: string;
}

interface MarkAllReadPayload {
  orgId: string;
}

/**
 * NotificationsGateway
 *
 * WebSocket gateway for the `/notifications` namespace.
 *
 * Connection flow:
 *   1. Client connects with `{ auth: { token: '<JWT>' } }`.
 *   2. The gateway verifies the RS256 JWT via JWKS (same public key used by the
 *      HTTP JwtStrategy — full signature verification, not just decode).
 *   3. The internal DB user is resolved from the `sub` claim (auth0Id).
 *   4. The socket is added to:
 *        - `user:<userId>`   — personal room (multi-device safe).
 *        - `org:<orgId>`     — one room per active organisation membership.
 *   5. The initial unread count is emitted as `notification:unread-count`.
 *
 * Redis pub/sub bridge (registered in `afterInit`):
 *   - `notifications:user:*` → emits `notification:new` to `user:<userId>`.
 *   - `notifications:org:*`  → emits `notification:new` to `org:<orgId>`.
 *   - `notifications:global` → broadcasts `notification:new` to all sockets.
 *
 * Socket.IO Redis adapter:
 *   Dedicated pub/sub connections (not shared with NotificationsPubSubService)
 *   are created for the Socket.IO adapter to enable cross-pod room fanout.
 *
 * `userSockets` map:
 *   Maintained for debug / single-pod metrics only. Not reliable cross-pod
 *   because each pod maintains its own copy.
 */
@WebSocketGateway({
  namespace: '/notifications',
  cors: { origin: true, credentials: true },
  transports: ['websocket', 'polling'],
})
export class NotificationsGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  private readonly server!: Server;

  private readonly logger = new Logger(NotificationsGateway.name);

  /** Debug-only: socket IDs per userId. Not reliable in a multi-pod setup. */
  private readonly userSockets: Map<string, Set<string>> = new Map();

  private readonly jwksClient: JwksClient;
  private readonly audience: string;
  private readonly issuer: string;

  constructor(
    private readonly pubSub: NotificationsPubSubService,
    private readonly notificationsService: NotificationsService,
    private readonly repo: NotificationsRepository,
    private readonly config: ConfigService,
  ) {
    this.audience = this.config.get<string>('auth.audience') ?? '';
    this.issuer = this.config.get<string>('auth.issuer') ?? '';
    const jwksUri = this.config.get<string>('auth.jwksUri') ?? '';

    this.jwksClient = new JwksClient({
      jwksUri,
      cache: true,
      rateLimit: true,
      jwksRequestsPerMinute: 5,
    });
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  afterInit(server: Server): void {
    // Attach dedicated Redis adapter connections for cross-pod Socket.IO room
    // synchronisation. These clients must not be shared with NotificationsPubSubService.
    const redisHost = process.env['REDIS_HOST'] ?? 'localhost';
    const redisPort = Number.parseInt(process.env['REDIS_PORT'] ?? '6379', 10);
    const pubClient = new Redis({ host: redisHost, port: redisPort });
    const subClient = pubClient.duplicate();
    // `afterInit` receives the Namespace, not the root Server, when a named
    // namespace is used. The adapter setter lives on the root Server instance,
    // accessible via `namespace.server`.
    const rootServer = (server as any).server ?? server;
    rootServer.adapter(createAdapter(pubClient, subClient));

    this.logger.log(
      'NotificationsGateway initialised — attaching Redis adapter and subscribing to channels',
    );

    // Bridge Redis pub/sub events to Socket.IO rooms.
    this.pubSub.subscribeToUserPattern(
      (event: RealtimeEvent<NotificationMessage>) =>
        this.handleUserNotificationMessage(event),
    );
    this.pubSub.subscribeToOrgPattern(
      (event: RealtimeEvent<NotificationMessage>) =>
        this.handleOrgNotificationMessage(event),
    );
    this.pubSub.subscribeToGlobal((event: RealtimeEvent<NotificationMessage>) =>
      this.handleGlobalNotificationMessage(event),
    );
  }

  /**
   * Emits the current unread count immediately after the socket
   * successfully authenticates and joins its rooms.
   *
   * @event notification:unread-count
   */
  async handleConnection(client: AuthenticatedSocket): Promise<void> {
    try {
      const token = this.extractToken(client);

      if (!token) {
        this.logger.warn(
          `Connection rejected — no token (socket: ${client.id})`,
        );
        client.disconnect();
        return;
      }

      const payload = await this.verifyToken(token);

      if (!payload?.sub) {
        this.logger.warn(
          `Connection rejected — missing sub claim (socket: ${client.id})`,
        );
        client.disconnect();
        return;
      }

      // Resolve internal DB user from Auth0 sub.
      const user = await this.repo.findUserByAuth0Id(payload.sub);

      if (!user) {
        this.logger.warn(
          `Connection rejected — user not found for sub: ${payload.sub}`,
        );
        client.disconnect();
        return;
      }

      client.userId = user.id;
      client.email = user.email;

      // Join personal room for direct delivery.
      await client.join(`user:${user.id}`);

      // Join an org room for every active membership (multi-tenant broadcast).
      const memberships = await this.repo.findActiveOrgMemberships(user.id);

      for (const { orgId } of memberships) {
        await client.join(`org:${orgId}`);
      }

      // Track socket for single-pod debug purposes.
      const sockets = this.userSockets.get(user.id) ?? new Set<string>();
      sockets.add(client.id);
      this.userSockets.set(user.id, sockets);

      // Emit the current unread count immediately on connect.
      const unreadCount = await this.notificationsService.getUnreadCount(
        user.id,
      );
      client.emit('notification:unread-count', { count: unreadCount });

      this.logger.log(
        `Socket connected: ${client.id} | user: ${user.id} | orgs: ${memberships.length}`,
      );
    } catch (error) {
      this.logger.error(`handleConnection error (socket: ${client.id})`, error);
      client.disconnect();
    }
  }

  handleDisconnect(client: AuthenticatedSocket): void {
    if (client.userId) {
      const sockets = this.userSockets.get(client.userId);
      if (sockets) {
        sockets.delete(client.id);
        if (sockets.size === 0) this.userSockets.delete(client.userId);
      }
    }

    this.logger.log(
      `Socket disconnected: ${client.id} | user: ${client.userId ?? 'unauthenticated'}`,
    );
  }

  // ── Message handlers ──────────────────────────────────────────────────────

  /**
   * Client requests a paginated notification list.
   * Server responds by emitting `notification:list` on the same socket.
   */
  @UseGuards(WsJwtGuard)
  @SubscribeMessage('notification:get-all')
  async handleGetAll(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: GetAllPayload,
  ): Promise<void> {
    if (!client.userId) return;

    const notifications = await this.notificationsService.getUserNotifications(
      client.userId,
      data?.orgId ?? '',
      {
        limit: data?.limit,
        offset: data?.offset,
        unreadOnly: data?.unreadOnly,
      },
    );

    client.emit('notification:list', notifications);
  }

  /**
   * Client marks a single notification as read.
   * Server responds by emitting the updated `notification:unread-count`.
   */
  @UseGuards(WsJwtGuard)
  @SubscribeMessage('notification:mark-read')
  async handleMarkRead(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: MarkReadPayload,
  ): Promise<void> {
    if (!client.userId || !data?.notificationId) return;

    await this.notificationsService.markAsRead(
      data.notificationId,
      client.userId,
    );

    const count = await this.notificationsService.getUnreadCount(client.userId);
    client.emit('notification:unread-count', { count });
  }

  /**
   * Client marks all notifications in an organisation as read.
   * Server responds with `notification:unread-count` carrying `{ count: 0 }`.
   */
  @UseGuards(WsJwtGuard)
  @SubscribeMessage('notification:mark-all-read')
  async handleMarkAllRead(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: MarkAllReadPayload,
  ): Promise<void> {
    if (!client.userId || !data?.orgId) return;

    await this.notificationsService.markAllAsRead(client.userId, data.orgId);
    client.emit('notification:unread-count', { count: 0 });
  }

  // ── Redis → Socket.IO bridges ─────────────────────────────────────────────

  /**
   * Forwards a `notification:new` event to the target user's room.
   *
   * @event notification:new
   */
  private handleUserNotificationMessage(
    event: RealtimeEvent<NotificationMessage>,
  ): void {
    const { userId } = event.payload;
    this.server.to(`user:${userId}`).emit('notification:new', event.payload);
    this.logger.debug(`Forwarded user notification to room user:${userId}`);
  }

  private handleOrgNotificationMessage(
    event: RealtimeEvent<NotificationMessage>,
  ): void {
    const { orgId } = event.payload;
    this.server.to(`org:${orgId}`).emit('notification:new', event.payload);
    this.logger.debug(`Forwarded org notification to room org:${orgId}`);
  }

  private handleGlobalNotificationMessage(
    event: RealtimeEvent<NotificationMessage>,
  ): void {
    this.server.emit('notification:new', event.payload);
    this.logger.debug('Forwarded global notification to all sockets');
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  /**
   * Extracts bearer token from socket handshake with the following precedence:
   *   1. `handshake.auth.token`
   *   2. `handshake.query.token`
   *   3. `handshake.headers.authorization`
   */
  private extractToken(client: AuthenticatedSocket): string | null {
    const fromAuth = client.handshake?.auth?.['token'];
    if (fromAuth) return String(fromAuth).replace(/^Bearer\s+/i, '');

    const fromQuery = client.handshake?.query?.['token'];
    if (fromQuery && typeof fromQuery === 'string')
      return fromQuery.replace(/^Bearer\s+/i, '');

    const fromHeader = client.handshake?.headers?.['authorization'];
    if (fromHeader && typeof fromHeader === 'string')
      return fromHeader.replace(/^Bearer\s+/i, '');

    return null;
  }

  /**
   * Verifies an RS256 JWT against the JWKS endpoint.
   *
   * Full cryptographic verification is performed — the token is never
   * blindly decoded without signature verification.
   */
  private verifyToken(
    token: string,
  ): Promise<jwt.JwtPayload & { sub: string }> {
    return new Promise((resolve, reject) => {
      const getKey: jwt.GetPublicKeyOrSecret = (header, callback) => {
        this.jwksClient.getSigningKey(
          header.kid,
          (err: Error | null, key: SigningKey | undefined) => {
            if (err) return callback(err);
            callback(null, key?.getPublicKey());
          },
        );
      };

      jwt.verify(
        token,
        getKey,
        { algorithms: ['RS256'], audience: this.audience, issuer: this.issuer },
        (err, decoded) => {
          if (err) return reject(err);
          resolve(decoded as jwt.JwtPayload & { sub: string });
        },
      );
    });
  }
}
