import {
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
} from '@nestjs/common';
import { ActivityLogService } from '@libs/activity-log';
import { LegalAuditService } from '@libs/legal-audit';
import { CacheService } from '@libs/redis';
import { NotificationsPubSubService } from './notifications-pubsub.service';
import { Notification } from '@libs/prisma-business';
import {
  NotificationMessage,
  UNREAD_CACHE_KEY,
  UNREAD_ORG_CACHE_KEY,
  UNREAD_CACHE_TTL_SECONDS,
} from '../../types/notification.types';
import { NotificationsRepository } from '../../infrastructure/repositories/notifications.repository';

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
    private readonly repo: NotificationsRepository,
    private readonly pubSub: NotificationsPubSubService,
    private readonly cache: CacheService,
    private readonly activityLog: ActivityLogService,
    private readonly legalAudit: LegalAuditService,
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
    const notification = await this.repo.create(input);

    // Atomically increment the unread counter and refresh its TTL.
    const key = UNREAD_CACHE_KEY(input.userId);
    await this.cache.getClient().incr(key);
    await this.cache.getClient().expire(key, UNREAD_CACHE_TTL_SECONDS);

    // Increment org-scoped counter.
    const orgKey = UNREAD_ORG_CACHE_KEY(input.userId, input.orgId);
    await this.cache.getClient().incr(orgKey);
    await this.cache.getClient().expire(orgKey, UNREAD_CACHE_TTL_SECONDS);

    // Publish realtime event so the gateway can push to connected sockets.
    await this.pubSub.publishUserNotification(
      input.userId,
      this.toMessage(notification),
    );

    this.logger.debug(
      `Created notification ${notification.id} for user ${input.userId}`,
    );

    this.activityLog.logActivity({
      orgId: input.orgId,
      actorId: input.userId,
      action: 'notification.created',
      entityType: 'notification',
      entityId: notification.id,
      metadata: { type: input.type, title: input.title },
    });
    this.legalAudit.recordEvent({
      eventType: 'notification.created',
      orgId: input.orgId,
      triggerType: 'system',
      metadata: { notificationId: notification.id, userId: input.userId, type: input.type },
    });

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
    return this.repo.findByUser(userId, orgId, opts);
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
    const count = await this.repo.countUnread(userId);

    const key = UNREAD_CACHE_KEY(userId);
    await this.cache.getClient().set(key, String(count));
    await this.cache.getClient().expire(key, UNREAD_CACHE_TTL_SECONDS);

    return count;
  }

  /**
   * Returns the unread count for a user within a specific organisation.
   * Redis is the primary source; on a cache miss the count is re-derived
   * from PostgreSQL and written back to Redis.
   */
  async getUnreadCountForOrg(userId: string, orgId: string): Promise<number> {
    const key = UNREAD_ORG_CACHE_KEY(userId, orgId);
    const raw = await this.cache.getClient().get(key);

    if (raw !== null) {
      return Math.max(0, Number.parseInt(raw, 10));
    }

    // Cache miss — recalculate from DB.
    const count = await this.repo.countUnreadForOrg(userId, orgId);

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
    const existing = await this.repo.findUnreadByIdAndUser(id, userId);

    if (!existing) {
      throw new NotFoundException(
        `Notification ${id} not found or already read`,
      );
    }

    const updated = await this.repo.markAsRead(id);

    // Decrement counter safely (floor at 0 is handled at read time).
    await this.cache.getClient().decrby(UNREAD_CACHE_KEY(userId), 1);
    // Decrement org-scoped counter.
    await this.cache
      .getClient()
      .decrby(UNREAD_ORG_CACHE_KEY(userId, existing.orgId), 1);

    await this.pubSub.publishUserNotification(userId, this.toMessage(updated));

    return updated;
  }

  /**
   * Marks multiple notifications as read in a single DB round-trip.
   * Uses `updateMany` result count to decrement the counter atomically —
   * this avoids over-decrementing when some IDs are already read.
   */
  async markManyAsRead(ids: string[], userId: string): Promise<void> {
    // Identify affected orgs for cache invalidation before the update.
    const orgIds = await this.repo.findOrgIdsForUnreadNotifications(
      ids,
      userId,
    );

    const count = await this.repo.markManyAsRead(ids, userId);

    if (count > 0) {
      await this.cache.getClient().decrby(UNREAD_CACHE_KEY(userId), count);
      // Invalidate org-scoped caches (next read recalculates from DB).
      for (const orgId of orgIds) {
        await this.cache.getClient().del(UNREAD_ORG_CACHE_KEY(userId, orgId));
      }
    }
  }

  /**
   * Marks ALL unread notifications as read for a user within an org and
   * deletes the Redis counter (next read will recalculate).
   */
  async markAllAsRead(userId: string, orgId: string): Promise<void> {
    await this.repo.markAllAsRead(userId, orgId);
    await this.cache.getClient().del(UNREAD_CACHE_KEY(userId));
    await this.cache.getClient().del(UNREAD_ORG_CACHE_KEY(userId, orgId));
  }

  // ── Delete ────────────────────────────────────────────────────────────────

  /**
   * Deletes a notification. If it was unread the Redis counter is decremented.
   */
  async deleteNotification(id: string, userId: string): Promise<void> {
    const existing = await this.repo.findByIdAndUser(id, userId);

    if (!existing) {
      throw new NotFoundException(`Notification ${id} not found`);
    }

    if (!existing.readAt) {
      await this.cache.getClient().decrby(UNREAD_CACHE_KEY(userId), 1);
      await this.cache
        .getClient()
        .decrby(UNREAD_ORG_CACHE_KEY(userId, existing.orgId), 1);
    }

    await this.repo.delete(id);

    this.activityLog.logActivity({
      orgId: existing.orgId,
      actorId: userId,
      action: 'notification.deleted',
      entityType: 'notification',
      entityId: id,
      metadata: { type: existing.type },
    });
    this.legalAudit.recordEvent({
      eventType: 'notification.deleted',
      orgId: existing.orgId,
      triggerType: 'user',
      metadata: { notificationId: id, userId },
    });
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
