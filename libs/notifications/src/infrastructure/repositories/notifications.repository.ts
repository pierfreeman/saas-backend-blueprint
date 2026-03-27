import { Injectable } from '@nestjs/common';
import { PrismaBusinessService } from '@libs/prisma-business';
import { Notification } from '@prisma/client';

export interface CreateNotificationData {
  orgId: string;
  userId: string;
  type: string;
  title: string;
  body: string;
  metadata?: Record<string, unknown> | null;
}

export interface FindNotificationsOptions {
  limit?: number;
  offset?: number;
  unreadOnly?: boolean;
}

/**
 * NotificationsRepository
 *
 * Wraps all PostgreSQL operations for the Notification model.
 * Redis cache management and WebSocket pub/sub remain in NotificationsService
 * as application-layer concerns.
 */
@Injectable()
export class NotificationsRepository {
  constructor(private readonly prisma: PrismaBusinessService) {}

  async create(data: CreateNotificationData): Promise<Notification> {
    return this.prisma.notification.create({
      data: {
        orgId: data.orgId,
        userId: data.userId,
        type: data.type,
        title: data.title,
        body: data.body,
        metadata: data.metadata ? (data.metadata as object) : undefined,
      },
    });
  }

  async findByUser(
    userId: string,
    orgId: string,
    opts: FindNotificationsOptions = {},
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

  async countUnread(userId: string): Promise<number> {
    return this.prisma.notification.count({
      where: { userId, readAt: null },
    });
  }

  /**
   * Find a single unread notification by id + userId. Returns null if not found
   * or already read. Used as a guard before marking as read.
   */
  async findUnreadByIdAndUser(
    id: string,
    userId: string,
  ): Promise<Notification | null> {
    return this.prisma.notification.findFirst({
      where: { id, userId, readAt: null },
    });
  }

  async markAsRead(id: string): Promise<Notification> {
    return this.prisma.notification.update({
      where: { id },
      data: { readAt: new Date() },
    });
  }

  /**
   * Mark multiple notifications as read for a user. Returns the count of
   * records actually updated (may be less than ids.length when some are
   * already read).
   */
  async markManyAsRead(ids: string[], userId: string): Promise<number> {
    const result = await this.prisma.notification.updateMany({
      where: { id: { in: ids }, userId, readAt: null },
      data: { readAt: new Date() },
    });
    return result.count;
  }

  async markAllAsRead(userId: string, orgId: string): Promise<void> {
    await this.prisma.notification.updateMany({
      where: { userId, orgId, readAt: null },
      data: { readAt: new Date() },
    });
  }

  async findByIdAndUser(
    id: string,
    userId: string,
  ): Promise<Notification | null> {
    return this.prisma.notification.findFirst({ where: { id, userId } });
  }

  async delete(id: string): Promise<void> {
    await this.prisma.notification.delete({ where: { id } });
  }

  /**
   * Resolve internal user record from an Auth0 subject claim.
   * Used by the WebSocket gateway during connection authentication.
   */
  async findUserByAuth0Id(
    auth0Id: string,
  ): Promise<{ id: string; email: string } | null> {
    return this.prisma.user.findUnique({
      where: { auth0Id },
      select: { id: true, email: true },
    });
  }

  /**
   * Return orgIds for all active memberships of a user.
   * Used by the WebSocket gateway to join per-org rooms.
   */
  async findActiveOrgMemberships(userId: string): Promise<{ orgId: string }[]> {
    return this.prisma.membership.findMany({
      where: { userId, status: 'ACTIVE' },
      select: { orgId: true },
    });
  }
}
