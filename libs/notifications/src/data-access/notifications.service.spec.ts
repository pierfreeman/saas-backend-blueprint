import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { NotificationsPubSubService } from './notifications-pubsub.service';
import { PrismaBusinessService } from '@libs/prisma-business';
import { CacheService } from '@libs/redis';
import { UNREAD_CACHE_KEY } from '../types/notification.types';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const NOW = new Date('2026-01-01T12:00:00Z');

const baseNotif = {
  id: 'notif-uuid-1',
  orgId: 'org-1',
  userId: 'user-1',
  type: 'alert',
  title: 'Hello',
  body: 'World',
  metadata: null,
  readAt: null,
  createdAt: NOW,
};

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockRedisClient = {
  incr: jest.fn().mockResolvedValue(1),
  expire: jest.fn().mockResolvedValue(1),
  decrby: jest.fn().mockResolvedValue(0),
  del: jest.fn().mockResolvedValue(1),
  get: jest.fn().mockResolvedValue(null),
  set: jest.fn().mockResolvedValue('OK'),
};

const mockCache = {
  getClient: jest.fn().mockReturnValue(mockRedisClient),
};

const mockPubSub = {
  publishUserNotification: jest.fn().mockResolvedValue(undefined),
};

const mockPrisma = {
  notification: {
    create: jest.fn(),
    count: jest.fn(),
    findMany: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
    delete: jest.fn(),
  },
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('NotificationsService', () => {
  let service: NotificationsService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationsService,
        { provide: PrismaBusinessService, useValue: mockPrisma },
        { provide: NotificationsPubSubService, useValue: mockPubSub },
        { provide: CacheService, useValue: mockCache },
      ],
    }).compile();

    service = module.get(NotificationsService);
  });

  // ── createNotification ─────────────────────────────────────────────────────

  describe('createNotification', () => {
    it('persists the notification, increments counter, and publishes', async () => {
      mockPrisma.notification.create.mockResolvedValue(baseNotif);

      const result = await service.createNotification({
        orgId: 'org-1',
        userId: 'user-1',
        type: 'alert',
        title: 'Hello',
        body: 'World',
      });

      expect(mockPrisma.notification.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ userId: 'user-1', orgId: 'org-1' }),
      });
      expect(mockRedisClient.incr).toHaveBeenCalledWith(
        UNREAD_CACHE_KEY('user-1'),
      );
      expect(mockRedisClient.expire).toHaveBeenCalled();
      expect(mockPubSub.publishUserNotification).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({ notificationId: 'notif-uuid-1' }),
      );
      expect(result.id).toBe('notif-uuid-1');
    });
  });

  // ── getUnreadCount ─────────────────────────────────────────────────────────

  describe('getUnreadCount', () => {
    it('returns cached value when present', async () => {
      mockRedisClient.get.mockResolvedValue('7');

      const count = await service.getUnreadCount('user-1');

      expect(count).toBe(7);
      expect(mockPrisma.notification.count).not.toHaveBeenCalled();
    });

    it('falls back to DB on cache miss and seeds Redis', async () => {
      mockRedisClient.get.mockResolvedValue(null);
      mockPrisma.notification.count.mockResolvedValue(3);

      const count = await service.getUnreadCount('user-1');

      expect(count).toBe(3);
      expect(mockRedisClient.set).toHaveBeenCalledWith(
        UNREAD_CACHE_KEY('user-1'),
        '3',
      );
    });

    it('returns 0 when cache value is negative (defensive)', async () => {
      mockRedisClient.get.mockResolvedValue('-1');

      const count = await service.getUnreadCount('user-1');

      expect(count).toBe(0);
    });
  });

  // ── markAsRead ─────────────────────────────────────────────────────────────

  describe('markAsRead', () => {
    it('marks notification as read and decrements counter', async () => {
      const updated = { ...baseNotif, readAt: NOW };
      mockPrisma.notification.findFirst.mockResolvedValue(baseNotif);
      mockPrisma.notification.update.mockResolvedValue(updated);

      const result = await service.markAsRead('notif-uuid-1', 'user-1');

      expect(result.readAt).toBe(NOW);
      expect(mockRedisClient.decrby).toHaveBeenCalledWith(
        UNREAD_CACHE_KEY('user-1'),
        1,
      );
      expect(mockPubSub.publishUserNotification).toHaveBeenCalled();
    });

    it('throws NotFoundException when notification not found', async () => {
      mockPrisma.notification.findFirst.mockResolvedValue(null);

      await expect(
        service.markAsRead('non-existent', 'user-1'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ── markManyAsRead ─────────────────────────────────────────────────────────

  describe('markManyAsRead', () => {
    it('decrements counter by the number of updated records', async () => {
      mockPrisma.notification.updateMany.mockResolvedValue({ count: 3 });

      await service.markManyAsRead(['a', 'b', 'c'], 'user-1');

      expect(mockRedisClient.decrby).toHaveBeenCalledWith(
        UNREAD_CACHE_KEY('user-1'),
        3,
      );
    });

    it('does not touch Redis counter when no records were updated', async () => {
      mockPrisma.notification.updateMany.mockResolvedValue({ count: 0 });

      await service.markManyAsRead([], 'user-1');

      expect(mockRedisClient.decrby).not.toHaveBeenCalled();
    });
  });

  // ── markAllAsRead ──────────────────────────────────────────────────────────

  describe('markAllAsRead', () => {
    it('updates all unread records and deletes the Redis counter', async () => {
      mockPrisma.notification.updateMany.mockResolvedValue({ count: 5 });

      await service.markAllAsRead('user-1', 'org-1');

      expect(mockPrisma.notification.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'user-1', orgId: 'org-1', readAt: null },
        }),
      );
      expect(mockRedisClient.del).toHaveBeenCalledWith(
        UNREAD_CACHE_KEY('user-1'),
      );
    });
  });

  // ── getUserNotifications ───────────────────────────────────────────────────

  describe('getUserNotifications', () => {
    it('returns paginated notifications ordered by createdAt desc', async () => {
      mockPrisma.notification.findMany.mockResolvedValue([baseNotif]);

      const results = await service.getUserNotifications('user-1', 'org-1', {
        limit: 10,
        offset: 0,
      });

      expect(results).toHaveLength(1);
      expect(mockPrisma.notification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'user-1', orgId: 'org-1' },
          take: 10,
          skip: 0,
        }),
      );
    });

    it('filters by unreadOnly when option is set', async () => {
      mockPrisma.notification.findMany.mockResolvedValue([]);

      await service.getUserNotifications('user-1', 'org-1', {
        unreadOnly: true,
      });

      expect(mockPrisma.notification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'user-1', orgId: 'org-1', readAt: null },
        }),
      );
    });
  });

  // ── notifyUser ────────────────────────────────────────────────────────────

  describe('notifyUser', () => {
    it('creates a notification for a single user', async () => {
      const notif = { ...baseNotif };
      mockPrisma.notification.create.mockResolvedValue(notif);
      mockRedisClient.incr.mockResolvedValue(1);
      mockRedisClient.expire.mockResolvedValue(1);
      mockPubSub.publishUserNotification.mockResolvedValue(undefined);

      const result = await service.notifyUser('user-1', 'org-1', {
        type: 'info',
        title: 'Hi',
        body: 'World',
      });

      expect(result.userId).toBe('user-1');
    });
  });

  // ── notifyManyUsers ───────────────────────────────────────────────────────

  describe('notifyManyUsers', () => {
    it('creates one notification per user', async () => {
      mockPrisma.notification.create.mockResolvedValue(baseNotif);
      mockRedisClient.incr.mockResolvedValue(1);
      mockRedisClient.expire.mockResolvedValue(1);
      mockPubSub.publishUserNotification.mockResolvedValue(undefined);

      const results = await service.notifyManyUsers(
        ['user-1', 'user-2', 'user-3'],
        'org-1',
        { type: 'info', title: 'Hi', body: 'World' },
      );

      expect(results).toHaveLength(3);
      expect(mockPrisma.notification.create).toHaveBeenCalledTimes(3);
    });
  });

  // ── deleteNotification ─────────────────────────────────────────────────────

  describe('deleteNotification', () => {
    it('deletes notification and decrements counter when unread', async () => {
      mockPrisma.notification.findFirst.mockResolvedValue(baseNotif);
      mockPrisma.notification.delete.mockResolvedValue(baseNotif);

      await service.deleteNotification('notif-uuid-1', 'user-1');

      expect(mockRedisClient.decrby).toHaveBeenCalledWith(
        UNREAD_CACHE_KEY('user-1'),
        1,
      );
      expect(mockPrisma.notification.delete).toHaveBeenCalledWith({
        where: { id: 'notif-uuid-1' },
      });
    });

    it('does not decrement counter when notification is already read', async () => {
      const readNotif = { ...baseNotif, readAt: NOW };
      mockPrisma.notification.findFirst.mockResolvedValue(readNotif);
      mockPrisma.notification.delete.mockResolvedValue(readNotif);

      await service.deleteNotification('notif-uuid-1', 'user-1');

      expect(mockRedisClient.decrby).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when notification does not belong to user', async () => {
      mockPrisma.notification.findFirst.mockResolvedValue(null);

      await expect(
        service.deleteNotification('ghost-id', 'user-1'),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
