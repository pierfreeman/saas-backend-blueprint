import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { NotificationsService } from '../../src/modules/notifications/services/notifications.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { NotificationsPubSubService } from '../../src/modules/notifications/redis/notifications-pubsub.service';

describe('NotificationsService', () => {
  let service: NotificationsService;
  let prismaService: any;
  let pubSubService: any;

  const mockNotification = {
    id: 'notif-123',
    userId: 'user-123',
    type: 'info',
    title: 'Test Notification',
    body: 'This is a test notification',
    metadata: { key: 'value' },
    readAt: null,
    createdAt: new Date(),
  };

  const mockUserId = 'user-123';

  beforeEach(async () => {
    const mockPrisma = {
      notification: {
        create: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
        delete: jest.fn(),
        deleteMany: jest.fn(),
        count: jest.fn(),
        createMany: jest.fn(),
      },
    } as any;

    const mockPubSub = {
      publishNotification: jest.fn(),
      publishBroadcast: jest.fn(),
      publishBulkRead: jest.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationsService,
        {
          provide: PrismaService,
          useValue: mockPrisma,
        },
        {
          provide: NotificationsPubSubService,
          useValue: mockPubSub,
        },
      ],
    }).compile();

    service = module.get<NotificationsService>(NotificationsService);
    prismaService = module.get(PrismaService);
    pubSubService = module.get(NotificationsPubSubService);
  });

  describe('createNotification', () => {
    it('should create notification and publish to Redis', async () => {
      const dto = {
        type: 'info',
        title: 'Test Notification',
        body: 'This is a test notification',
        metadata: { key: 'value' },
      };

      prismaService.notification.create.mockResolvedValue(mockNotification);
      pubSubService.publishNotification.mockResolvedValue(undefined);

      const result = await service.createNotification(mockUserId, dto);

      expect(result).toEqual({
        id: mockNotification.id,
        userId: mockNotification.userId,
        type: mockNotification.type,
        title: mockNotification.title,
        body: mockNotification.body,
        metadata: mockNotification.metadata,
        readAt: mockNotification.readAt,
        createdAt: mockNotification.createdAt,
      });

      expect(prismaService.notification.create).toHaveBeenCalledWith({
        data: {
          userId: mockUserId,
          type: dto.type,
          title: dto.title,
          body: dto.body,
          metadata: dto.metadata,
        },
      });

      expect(pubSubService.publishNotification).toHaveBeenCalledWith(
        mockUserId,
        expect.objectContaining({
          notificationId: mockNotification.id,
          userId: mockNotification.userId,
          type: mockNotification.type,
          title: mockNotification.title,
          body: mockNotification.body,
        }),
      );
    });

    it('should handle notification without metadata', async () => {
      const dto = {
        type: 'info',
        title: 'Test Notification',
        body: 'This is a test notification',
      };

      const notificationWithoutMetadata = { ...mockNotification, metadata: null };
      prismaService.notification.create.mockResolvedValue(notificationWithoutMetadata);
      pubSubService.publishNotification.mockResolvedValue(undefined);

      const result = await service.createNotification(mockUserId, dto);

      expect(result.metadata).toBeNull();
      expect(prismaService.notification.create).toHaveBeenCalledWith({
        data: {
          userId: mockUserId,
          type: dto.type,
          title: dto.title,
          body: dto.body,
          metadata: null,
        },
      });
    });
  });

  describe('getUserNotifications', () => {
    it('should return all notifications for user', async () => {
      const mockNotifications = [mockNotification];
      prismaService.notification.findMany.mockResolvedValue(mockNotifications);

      const result = await service.getUserNotifications(mockUserId, {});

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(mockNotification.id);
      expect(prismaService.notification.findMany).toHaveBeenCalledWith({
        where: { userId: mockUserId },
        orderBy: { createdAt: 'desc' },
        take: 50,
        skip: 0,
      });
    });

    it('should return only unread notifications when unreadOnly is true', async () => {
      const query = { unreadOnly: true, limit: 10, skip: 0 };
      prismaService.notification.findMany.mockResolvedValue([mockNotification]);

      await service.getUserNotifications(mockUserId, query);

      expect(prismaService.notification.findMany).toHaveBeenCalledWith({
        where: { userId: mockUserId, readAt: null },
        orderBy: { createdAt: 'desc' },
        take: 10,
        skip: 0,
      });
    });

    it('should apply limit and skip parameters', async () => {
      const query = { limit: 20, skip: 10 };
      prismaService.notification.findMany.mockResolvedValue([]);

      await service.getUserNotifications(mockUserId, query);

      expect(prismaService.notification.findMany).toHaveBeenCalledWith({
        where: { userId: mockUserId },
        orderBy: { createdAt: 'desc' },
        take: 20,
        skip: 10,
      });
    });
  });

  describe('getUnreadCount', () => {
    it('should return count of unread notifications', async () => {
      prismaService.notification.count.mockResolvedValue(5);

      const count = await service.getUnreadCount(mockUserId);

      expect(count).toBe(5);
      expect(prismaService.notification.count).toHaveBeenCalledWith({
        where: { userId: mockUserId, readAt: null },
      });
    });
  });

  describe('markAsRead', () => {
    it('should mark notification as read', async () => {
      const notificationId = 'notif-123';
      const readNotification = { ...mockNotification, readAt: new Date() };

      prismaService.notification.findFirst.mockResolvedValue(mockNotification);
      prismaService.notification.update.mockResolvedValue(readNotification);

      const result = await service.markAsRead(mockUserId, notificationId);

      expect(result.readAt).toBeDefined();
      expect(prismaService.notification.update).toHaveBeenCalledWith({
        where: { id: notificationId },
        data: { readAt: expect.any(Date) },
      });
    });

    it('should throw NotFoundException if notification does not exist', async () => {
      prismaService.notification.findFirst.mockResolvedValue(null);

      await expect(service.markAsRead(mockUserId, 'invalid-id')).rejects.toThrow(NotFoundException);
    });

    it('should return notification if already read', async () => {
      const readNotification = { ...mockNotification, readAt: new Date() };
      prismaService.notification.findFirst.mockResolvedValue(readNotification);

      const result = await service.markAsRead(mockUserId, 'notif-123');

      expect(result.readAt).toBeDefined();
      expect(prismaService.notification.update).not.toHaveBeenCalled();
    });
  });

  describe('markManyAsRead', () => {
    it('should mark multiple notifications as read', async () => {
      const notificationIds = ['notif-1', 'notif-2', 'notif-3'];
      prismaService.notification.updateMany.mockResolvedValue({ count: 3 });
      pubSubService.publishBulkRead.mockResolvedValue(undefined);

      const count = await service.markManyAsRead(mockUserId, notificationIds);

      expect(count).toBe(3);
      expect(prismaService.notification.updateMany).toHaveBeenCalledWith({
        where: {
          id: { in: notificationIds },
          userId: mockUserId,
          readAt: null,
        },
        data: { readAt: expect.any(Date) },
      });
      expect(pubSubService.publishBulkRead).toHaveBeenCalledWith(mockUserId, notificationIds);
    });

    it('should not publish to Redis if no notifications updated', async () => {
      prismaService.notification.updateMany.mockResolvedValue({ count: 0 });

      const count = await service.markManyAsRead(mockUserId, ['notif-1']);

      expect(count).toBe(0);
      expect(pubSubService.publishBulkRead).not.toHaveBeenCalled();
    });
  });

  describe('markAllAsRead', () => {
    it('should mark all unread notifications as read', async () => {
      prismaService.notification.updateMany.mockResolvedValue({ count: 5 });

      const count = await service.markAllAsRead(mockUserId);

      expect(count).toBe(5);
      expect(prismaService.notification.updateMany).toHaveBeenCalledWith({
        where: { userId: mockUserId, readAt: null },
        data: { readAt: expect.any(Date) },
      });
    });
  });

  describe('notifyManyUsers', () => {
    it('should create notifications for multiple users', async () => {
      const userIds = ['user-1', 'user-2', 'user-3'];
      const dto = {
        type: 'info',
        title: 'Broadcast',
        body: 'Message to all',
      };

      prismaService.notification.createMany.mockResolvedValue({ count: 3 });
      prismaService.notification.findMany.mockResolvedValue([
        { ...mockNotification, userId: 'user-1' },
        { ...mockNotification, userId: 'user-2' },
        { ...mockNotification, userId: 'user-3' },
      ]);
      pubSubService.publishNotification.mockResolvedValue(undefined);

      await service.notifyManyUsers(userIds, dto);

      expect(prismaService.notification.createMany).toHaveBeenCalledWith({
        data: [
          {
            userId: 'user-1',
            type: dto.type,
            title: dto.title,
            body: dto.body,
            metadata: null,
          },
          {
            userId: 'user-2',
            type: dto.type,
            title: dto.title,
            body: dto.body,
            metadata: null,
          },
          {
            userId: 'user-3',
            type: dto.type,
            title: dto.title,
            body: dto.body,
            metadata: null,
          },
        ],
      });

      expect(pubSubService.publishNotification).toHaveBeenCalledTimes(3);
    });
  });

  describe('deleteNotification', () => {
    it('should delete notification', async () => {
      const notificationId = 'notif-123';
      prismaService.notification.findFirst.mockResolvedValue(mockNotification);
      prismaService.notification.delete.mockResolvedValue(mockNotification);

      await service.deleteNotification(mockUserId, notificationId);

      expect(prismaService.notification.delete).toHaveBeenCalledWith({
        where: { id: notificationId },
      });
    });

    it('should throw NotFoundException if notification does not exist', async () => {
      prismaService.notification.findFirst.mockResolvedValue(null);

      await expect(service.deleteNotification(mockUserId, 'invalid-id')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
