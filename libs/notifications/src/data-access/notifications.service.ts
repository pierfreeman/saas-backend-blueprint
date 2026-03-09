import {
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
} from '@nestjs/common';
import { PrismaBusinessService } from '@libs/prisma-business';
import { CacheService } from '@libs/redis';
import { NotificationsPubSubService } from './notifications-pubsub.service';
import { Notification } from '@prisma/client';
import {
  NotificationMessage,
  UNREAD_CACHE_KEY,
  UNREAD_CACHE_TTL_SECONDS,
} from '../types/notification.types';

export interface CreateNotificationInput {
  orgId: string;
  userId: string;
  type: string;
  title: string;
  body: string;
  metadata?: Record<string, unknown> | null;
}

export interface GetNotificationsOptions {
  limit?: number;
  offset?: number;
  unreadOnly?: boolean;
}

/**
 * NotificationsService
 *
 * Business logic layer for the in-app notification system.
 *
 * Storage: PostgreSQL (via Prisma) — single source of truth.
 * Cache:   Redis (unread counter per user, TTL 30 days).
 * Realtime: Redis pub/sub (events dispatched to NotificationsGateway).
 */
@Injectable()
export class NotificationsService implements OnModuleDestroy {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaBusinessService,
    private readonly pubSub: NotificationsPubSubService,
    private readonly cache: CacheService,
  ) {}

  async onModuleDestroy(): Promise<void> {
    // PubSub and Cache handle their own cleanup; nothing to do here.
  }

  // ── Create ────────────────────────────────────────────────────────────────

  /**
   * Persists a notification, increments the Redis unread counter, and
   * publishes a realtime event to the user channel.
   */
  async createNotification(
    input: CreateNotificationInput,
  ): Promise<Notification> {
    const notification = await this.prisma.notification.create({
      data: {
        orgId: input.orgId,
        userId: input.userId,
        type: input.type,
        title: input.title,
        body: input.body,
        metadata: input.metadata ? (input.metadata as object) : undefined,
      },
    });

    // Atomically increment the unread counter and refresh its TTL.
    const key = UNREAD_CACHE_KEY(input.userId);
    await this.cache.getClient().incr(key);
    await this.cache.getClient().expire(key, UNREAD_CACHE_TTL_SECONDS);

    // Publish realtime event so the gateway can push to connected sockets.
    await this.pubSub.publishUserNotification(
      input.userId,
      this.toMessage(notification),
    );

    this.logger.debug(
      `Created notification ${notification.id} for user ${input.userId}`,
    );

    return notification;
  }

  /**
   * Convenience wrapper — creates a notification for a single user.
   */
  async notifyUser(
    userId: string,
    orgId: string,
    data: Omit<CreateNotificationInput, 'userId' | 'orgId'>,
  ): Promise<Notification> {
    return this.createNotification({ ...data, userId, orgId });
  }

  /**
   * Convenience wrapper — creates the same notification for multiple users.
   * Each user gets an independent DB record and Redis event.
   */
  async notifyManyUsers(
    userIds: string[],
    orgId: string,
    data: Omit<CreateNotificationInput, 'userId' | 'orgId'>,
  ): Promise<Notification[]> {
    return Promise.all(
      userIds.map((userId) =>
        this.createNotification({ ...data, userId, orgId }),
      ),
    );
  }

  // ── Read / mark-as-read ───────────────────────────────────────────────────

  /**
   * Returns paginated notifications for a user within an organisation.
   */
  async getUserNotifications(
    userId: string,
    orgId: string,
    opts: GetNotificationsOptions = {},
  ): Promise<Notification[]> {
    const { limit = 20, offset = 0, unreadOnly = false } = opts;

    return this.prisma.notification.findMany({
      where: {
        userId,
        orgId,
        ...(unreadOnly ? { readAt: null } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
    });
  }

  /**
   * Returns the unread count for a user.
   * Redis is the primary source; on a cache miss the count is re-derived
   * from PostgreSQL and written back to Redis.
   */
  async getUnreadCount(userId: string): Promise<number> {
    const raw = await this.cache.getClient().get(UNREAD_CACHE_KEY(userId));

    if (raw !== null) {
      return Math.max(0, Number.parseInt(raw, 10));
    }

    // Cache miss — recalculate from DB.
    const count = await this.prisma.notification.count({
      where: { userId, readAt: null },
    });

    const key = UNREAD_CACHE_KEY(userId);
    await this.cache.getClient().set(key, String(count));
    await this.cache.getClient().expire(key, UNREAD_CACHE_TTL_SECONDS);

    return count;
  }

  /**
   * Marks a single notification as read and decrements the Redis counter.
   * Throws NotFoundException if the notification does not exist, is already
   * read, or does not belong to the given user.
   */
  async markAsRead(id: string, userId: string): Promise<Notification> {
    const existing = await this.prisma.notification.findFirst({
      where: { id, userId, readAt: null },
    });

    if (!existing) {
      throw new NotFoundException(
        `Notification ${id} not found or already read`,
      );
    }

    const updated = await this.prisma.notification.update({
      where: { id },
      data: { readAt: new Date() },
    });

    // Decrement counter safely (floor at 0 is handled at read time).
    await this.cache.getClient().decrby(UNREAD_CACHE_KEY(userId), 1);

    await this.pubSub.publishUserNotification(userId, this.toMessage(updated));

    return updated;
  }

  /**
   * Marks multiple notifications as read in a single DB round-trip.
   * Uses `updateMany` result count to decrement the counter atomically —
   * this avoids over-decrementing when some IDs are already read.
   */
  async markManyAsRead(ids: string[], userId: string): Promise<void> {
    const result = await this.prisma.notification.updateMany({
      where: { id: { in: ids }, userId, readAt: null },
      data: { readAt: new Date() },
    });

    if (result.count > 0) {
      await this.cache
        .getClient()
        .decrby(UNREAD_CACHE_KEY(userId), result.count);
    }
  }

  /**
   * Marks ALL unread notifications as read for a user within an org and
   * deletes the Redis counter (next read will recalculate).
   */
  async markAllAsRead(userId: string, orgId: string): Promise<void> {
    await this.prisma.notification.updateMany({
      where: { userId, orgId, readAt: null },
      data: { readAt: new Date() },
    });

    await this.cache.getClient().del(UNREAD_CACHE_KEY(userId));
  }

  // ── Delete ────────────────────────────────────────────────────────────────

  /**
   * Deletes a notification. If it was unread the Redis counter is decremented.
   */
  async deleteNotification(id: string, userId: string): Promise<void> {
    const existing = await this.prisma.notification.findFirst({
      where: { id, userId },
    });

    if (!existing) {
      throw new NotFoundException(`Notification ${id} not found`);
    }

    if (!existing.readAt) {
      await this.cache.getClient().decrby(UNREAD_CACHE_KEY(userId), 1);
    }

    await this.prisma.notification.delete({ where: { id } });
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private toMessage(n: Notification): NotificationMessage {
    return {
      notificationId: n.id,
      userId: n.userId,
      orgId: n.orgId,
      type: n.type,
      title: n.title,
      body: n.body,
      metadata: n.metadata as Record<string, unknown> | null,
      createdAt: n.createdAt,
    };
  }
}
