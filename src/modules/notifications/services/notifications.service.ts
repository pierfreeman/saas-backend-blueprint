import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  NotificationsPubSubService,
  NotificationMessage,
} from '../redis/notifications-pubsub.service';
import { CreateNotificationDto, NotificationResponseDto, GetNotificationsDto } from '../dto';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly pubSub: NotificationsPubSubService,
  ) {}

  async createNotification(
    userId: string,
    dto: CreateNotificationDto,
  ): Promise<NotificationResponseDto> {
    this.logger.debug(`Creating notification for user: ${userId}`);

    const notification = await this.prisma.notification.create({
      data: {
        userId,
        type: dto.type,
        title: dto.title,
        body: dto.body,
        metadata: dto.metadata ? (dto.metadata as any) : null,
      },
    });

    // Publish to Redis for real-time delivery
    await this.notifyUser(userId, notification);

    return this.mapToDto(notification);
  }

  async notifyUser(userId: string, notification: any): Promise<void> {
    const message: NotificationMessage = {
      notificationId: notification.id,
      userId: notification.userId,
      type: notification.type,
      title: notification.title,
      body: notification.body,
      metadata: notification.metadata,
      createdAt: notification.createdAt,
    };

    await this.pubSub.publishNotification(userId, message);
    this.logger.debug(`Notification published to Redis for user: ${userId}`);
  }

  async notifyManyUsers(userIds: string[], dto: CreateNotificationDto): Promise<void> {
    this.logger.debug(`Creating notifications for ${userIds.length} users`);

    const notifications = await this.prisma.notification.createMany({
      data: userIds.map((userId) => ({
        userId,
        type: dto.type,
        title: dto.title,
        body: dto.body,
        metadata: dto.metadata ? (dto.metadata as any) : null,
      })),
    });

    this.logger.log(`Created ${notifications.count} notifications`);

    // Fetch created notifications to publish to Redis
    const createdNotifications = await this.prisma.notification.findMany({
      where: {
        userId: { in: userIds },
        type: dto.type,
        title: dto.title,
      },
      orderBy: { createdAt: 'desc' },
      take: userIds.length,
    });

    // Publish each notification to Redis
    await Promise.all(
      createdNotifications.map((notification) =>
        this.notifyUser(notification.userId, notification),
      ),
    );
  }

  async getUserNotifications(
    userId: string,
    query: GetNotificationsDto,
  ): Promise<NotificationResponseDto[]> {
    const { unreadOnly, limit = 50, skip = 0 } = query;

    const notifications = await this.prisma.notification.findMany({
      where: {
        userId,
        ...(unreadOnly ? { readAt: null } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip,
    });

    return notifications.map(this.mapToDto);
  }

  async getUnreadCount(userId: string): Promise<number> {
    return this.prisma.notification.count({
      where: {
        userId,
        readAt: null,
      },
    });
  }

  async markAsRead(userId: string, notificationId: string): Promise<NotificationResponseDto> {
    const notification = await this.prisma.notification.findFirst({
      where: { id: notificationId, userId },
    });

    if (!notification) {
      throw new NotFoundException('Notification not found');
    }

    if (notification.readAt) {
      return this.mapToDto(notification);
    }

    const updated = await this.prisma.notification.update({
      where: { id: notificationId },
      data: { readAt: new Date() },
    });

    return this.mapToDto(updated);
  }

  async markManyAsRead(userId: string, notificationIds: string[]): Promise<number> {
    const result = await this.prisma.notification.updateMany({
      where: {
        id: { in: notificationIds },
        userId,
        readAt: null,
      },
      data: { readAt: new Date() },
    });

    this.logger.debug(`Marked ${result.count} notifications as read for user: ${userId}`);

    // Publish bulk read event
    if (result.count > 0) {
      await this.pubSub.publishBulkRead(userId, notificationIds);
    }

    return result.count;
  }

  async markAllAsRead(userId: string): Promise<number> {
    const result = await this.prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });

    this.logger.log(`Marked all ${result.count} notifications as read for user: ${userId}`);

    return result.count;
  }

  async deleteNotification(userId: string, notificationId: string): Promise<void> {
    const notification = await this.prisma.notification.findFirst({
      where: { id: notificationId, userId },
    });

    if (!notification) {
      throw new NotFoundException('Notification not found');
    }

    await this.prisma.notification.delete({
      where: { id: notificationId },
    });

    this.logger.debug(`Deleted notification: ${notificationId}`);
  }

  private mapToDto(notification: any): NotificationResponseDto {
    return {
      id: notification.id,
      userId: notification.userId,
      type: notification.type,
      title: notification.title,
      body: notification.body,
      metadata: notification.metadata,
      readAt: notification.readAt,
      createdAt: notification.createdAt,
    };
  }
}
