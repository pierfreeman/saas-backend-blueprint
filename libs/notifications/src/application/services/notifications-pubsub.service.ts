import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import {
  RealtimeEvent,
  NotificationMessage,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_PATTERNS,
  NOTIFICATION_EVENTS,
} from '../../types/notification.types';

type NotificationHandler = (event: RealtimeEvent<NotificationMessage>) => void;

/**
 * NotificationsPubSubService
 *
 * Manages the Redis pub/sub transport for realtime notifications.
 *
 * Two dedicated ioredis connections are maintained:
 *   - `publisher`  — used exclusively for PUBLISH commands.
 *   - `subscriber` — used exclusively for SUBSCRIBE / PSUBSCRIBE.
 *
 * A Redis connection in subscribe mode cannot issue regular commands, so
 * the two-connection pattern is mandatory (same approach used internally
 * by ioredis and BullMQ).
 *
 * These connections are intentionally separate from the Socket.IO adapter
 * connections created in the NotificationsGateway.
 */
@Injectable()
export class NotificationsPubSubService implements OnModuleDestroy {
  private readonly logger = new Logger(NotificationsPubSubService.name);

  private readonly publisher: Redis;
  private readonly subscriber: Redis;

  constructor() {
    const opts = {
      host: process.env['REDIS_HOST'] ?? 'localhost',
      port: Number.parseInt(process.env['REDIS_PORT'] ?? '6379', 10),
      retryStrategy: (times: number) => Math.min(times * 50, 2000),
    };

    this.publisher = new Redis(opts);
    this.subscriber = new Redis(opts);

    this.publisher.on('connect', () =>
      this.logger.log('Notifications PubSub publisher connected'),
    );
    this.publisher.on('error', (err) =>
      this.logger.error('Notifications PubSub publisher error', err),
    );
    this.subscriber.on('connect', () =>
      this.logger.log('Notifications PubSub subscriber connected'),
    );
    this.subscriber.on('error', (err) =>
      this.logger.error('Notifications PubSub subscriber error', err),
    );
  }

  // ── Publish ───────────────────────────────────────────────────────────────

  /**
   * Publishes a notification event to the user-scoped Redis channel.
   * Channel: `notifications:user:<userId>`
   */
  async publishUserNotification(
    userId: string,
    msg: NotificationMessage,
  ): Promise<void> {
    const event: RealtimeEvent<NotificationMessage> = {
      event: NOTIFICATION_EVENTS.CREATED,
      scope: 'user',
      userId,
      payload: msg,
      timestamp: new Date().toISOString(),
    };
    await this.publish(NOTIFICATION_CHANNELS.user(userId), event);
  }

  /**
   * Publishes a notification event to the org-scoped Redis channel.
   * Channel: `notifications:org:<orgId>`
   */
  async publishOrgNotification(
    orgId: string,
    msg: NotificationMessage,
  ): Promise<void> {
    const event: RealtimeEvent<NotificationMessage> = {
      event: NOTIFICATION_EVENTS.CREATED,
      scope: 'org',
      orgId,
      payload: msg,
      timestamp: new Date().toISOString(),
    };
    await this.publish(NOTIFICATION_CHANNELS.org(orgId), event);
  }

  /**
   * Publishes a notification event to the global broadcast channel.
   * Channel: `notifications:global`
   */
  async publishGlobalNotification(msg: NotificationMessage): Promise<void> {
    const event: RealtimeEvent<NotificationMessage> = {
      event: NOTIFICATION_EVENTS.CREATED,
      scope: 'global',
      payload: msg,
      timestamp: new Date().toISOString(),
    };
    await this.publish(NOTIFICATION_CHANNELS.global, event);
  }

  // ── Subscribe ─────────────────────────────────────────────────────────────

  /**
   * Pattern-subscribes to `notifications:user:*` and invokes `handler` for
   * every matching message. The gateway registers this once on `afterInit`.
   */
  subscribeToUserPattern(handler: NotificationHandler): void {
    this.subscriber.psubscribe(NOTIFICATION_PATTERNS.user);

    this.subscriber.on(
      'pmessage',
      (_pattern: string, channel: string, raw: string) => {
        if (!channel.startsWith('notifications:user:')) return;
        this.safeHandle(channel, raw, handler);
      },
    );

    this.logger.log(`Pattern-subscribed to: "${NOTIFICATION_PATTERNS.user}"`);
  }

  /**
   * Pattern-subscribes to `notifications:org:*` and invokes `handler` for
   * every matching message.
   */
  subscribeToOrgPattern(handler: NotificationHandler): void {
    this.subscriber.psubscribe(NOTIFICATION_PATTERNS.org);

    this.subscriber.on(
      'pmessage',
      (_pattern: string, channel: string, raw: string) => {
        if (!channel.startsWith('notifications:org:')) return;
        this.safeHandle(channel, raw, handler);
      },
    );

    this.logger.log(`Pattern-subscribed to: "${NOTIFICATION_PATTERNS.org}"`);
  }

  /**
   * Subscribes to `notifications:global` and invokes `handler` for every
   * published message.
   */
  subscribeToGlobal(handler: NotificationHandler): void {
    this.subscriber.subscribe(NOTIFICATION_CHANNELS.global);

    this.subscriber.on('message', (channel: string, raw: string) => {
      if (channel !== NOTIFICATION_CHANNELS.global) return;
      this.safeHandle(channel, raw, handler);
    });

    this.logger.log(`Subscribed to: "${NOTIFICATION_CHANNELS.global}"`);
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  async onModuleDestroy(): Promise<void> {
    this.logger.log('Disconnecting notification pub/sub connections…');
    await Promise.all([this.publisher.quit(), this.subscriber.quit()]);
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private async publish(
    channel: string,
    event: RealtimeEvent<NotificationMessage>,
  ): Promise<void> {
    try {
      const message = JSON.stringify(event);
      const receivers = await this.publisher.publish(channel, message);
      this.logger.debug(
        `Published to "${channel}" — ${receivers} subscriber(s)`,
      );
    } catch (error) {
      this.logger.error(`Failed to publish to "${channel}":`, error);
      throw error;
    }
  }

  private safeHandle(
    channel: string,
    raw: string,
    handler: NotificationHandler,
  ): void {
    try {
      handler(JSON.parse(raw) as RealtimeEvent<NotificationMessage>);
    } catch {
      this.logger.error(`Failed to parse message from channel "${channel}"`);
    }
  }
}
