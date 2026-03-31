import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { NotificationsPubSubService } from './notifications-pubsub.service';
import { NotificationsRepository } from '../../infrastructure/repositories/notifications.repository';
import { CacheService } from '@libs/redis';
import {
  UNREAD_CACHE_KEY,
  UNREAD_ORG_CACHE_KEY,
} from '../../types/notification.types';
import { vi } from 'vitest';

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
  incr: vi.fn().mockResolvedValue(1),
  expire: vi.fn().mockResolvedValue(1),
  decrby: vi.fn().mockResolvedValue(0),
  del: vi.fn().mockResolvedValue(1),
  get: vi.fn().mockResolvedValue(null),
  set: vi.fn().mockResolvedValue('OK'),
};

const mockCache = {
  getClient: vi.fn().mockReturnValue(mockRedisClient),
};

const mockPubSub = {
  publishUserNotification: vi.fn().mockResolvedValue(undefined),
};

const mockRepo = {
  create: vi.fn(),
  findByUser: vi.fn(),
  countUnread: vi.fn(),
  countUnreadForOrg: vi.fn(),
  findUnreadByIdAndUser: vi.fn(),
  markAsRead: vi.fn(),
  markManyAsRead: vi.fn(),
  markAllAsRead: vi.fn(),
  findByIdAndUser: vi.fn(),
  delete: vi.fn(),
  findOrgIdsForUnreadNotifications: vi.fn(),
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('NotificationsService', () => {
  let service: NotificationsService;

  beforeEach(async () => {
    vi.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationsService,
        { provide: NotificationsRepository, useValue: mockRepo },
        { provide: NotificationsPubSubService, useValue: mockPubSub },
        { provide: CacheService, useValue: mockCache },
      ],
    }).compile();

    service = module.get(NotificationsService);
  });

  // ── createNotification ─────────────────────────────────────────────────────

  describe('createNotification', () => {
    it('persists the notification, increments counter, and publishes', async () => {
      mockRepo.create.mockResolvedValue(baseNotif);

      const result = await service.createNotification({
        orgId: 'org-1',
        userId: 'user-1',
        type: 'alert',
        title: 'Hello',
        body: 'World',
      });

      expect(mockRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'user-1', orgId: 'org-1' }),
      );
      expect(mockRedisClient.incr).toHaveBeenCalledWith(
        UNREAD_CACHE_KEY('user-1'),
      );
      expect(mockRedisClient.incr).toHaveBeenCalledWith(
        UNREAD_ORG_CACHE_KEY('user-1', 'org-1'),
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
      expect(mockRepo.countUnread).not.toHaveBeenCalled();
    });

    it('falls back to DB on cache miss and seeds Redis', async () => {
      mockRedisClient.get.mockResolvedValue(null);
      mockRepo.countUnread.mockResolvedValue(3);

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

  // ── getUnreadCountForOrg ───────────────────────────────────────────────────

  describe('getUnreadCountForOrg', () => {
    it('returns cached value when present', async () => {
      mockRedisClient.get.mockResolvedValue('4');

      const count = await service.getUnreadCountForOrg('user-1', 'org-1');

      expect(count).toBe(4);
      expect(mockRedisClient.get).toHaveBeenCalledWith(
        UNREAD_ORG_CACHE_KEY('user-1', 'org-1'),
      );
      expect(mockRepo.countUnreadForOrg).not.toHaveBeenCalled();
    });

    it('falls back to DB on cache miss and seeds Redis', async () => {
      mockRedisClient.get.mockResolvedValue(null);
      mockRepo.countUnreadForOrg.mockResolvedValue(2);

      const count = await service.getUnreadCountForOrg('user-1', 'org-1');

      expect(count).toBe(2);
      expect(mockRedisClient.set).toHaveBeenCalledWith(
        UNREAD_ORG_CACHE_KEY('user-1', 'org-1'),
        '2',
      );
    });

    it('returns 0 when cache value is negative', async () => {
      mockRedisClient.get.mockResolvedValue('-1');

      const count = await service.getUnreadCountForOrg('user-1', 'org-1');

      expect(count).toBe(0);
    });
  });

  // ── markAsRead ─────────────────────────────────────────────────────────────

  describe('markAsRead', () => {
    it('marks notification as read and decrements both global and org counters', async () => {
      const updated = { ...baseNotif, readAt: NOW };
      mockRepo.findUnreadByIdAndUser.mockResolvedValue(baseNotif);
      mockRepo.markAsRead.mockResolvedValue(updated);

      const result = await service.markAsRead('notif-uuid-1', 'user-1');

      expect(result.readAt).toBe(NOW);
      expect(mockRedisClient.decrby).toHaveBeenCalledWith(
        UNREAD_CACHE_KEY('user-1'),
        1,
      );
      expect(mockRedisClient.decrby).toHaveBeenCalledWith(
        UNREAD_ORG_CACHE_KEY('user-1', 'org-1'),
        1,
      );
      expect(mockPubSub.publishUserNotification).toHaveBeenCalled();
    });

    it('throws NotFoundException when notification not found', async () => {
      mockRepo.findUnreadByIdAndUser.mockResolvedValue(null);

      await expect(
        service.markAsRead('non-existent', 'user-1'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ── markManyAsRead ─────────────────────────────────────────────────────────

  describe('markManyAsRead', () => {
    it('decrements global counter and invalidates org caches', async () => {
      mockRepo.findOrgIdsForUnreadNotifications.mockResolvedValue(['org-1']);
      mockRepo.markManyAsRead.mockResolvedValue(3);

      await service.markManyAsRead(['a', 'b', 'c'], 'user-1');

      expect(mockRedisClient.decrby).toHaveBeenCalledWith(
        UNREAD_CACHE_KEY('user-1'),
        3,
      );
      expect(mockRedisClient.del).toHaveBeenCalledWith(
        UNREAD_ORG_CACHE_KEY('user-1', 'org-1'),
      );
    });

    it('does not touch Redis counter when no records were updated', async () => {
      mockRepo.findOrgIdsForUnreadNotifications.mockResolvedValue([]);
      mockRepo.markManyAsRead.mockResolvedValue(0);

      await service.markManyAsRead([], 'user-1');

      expect(mockRedisClient.decrby).not.toHaveBeenCalled();
    });

    it('invalidates multiple org caches when notifications span orgs', async () => {
      mockRepo.findOrgIdsForUnreadNotifications.mockResolvedValue([
        'org-1',
        'org-2',
      ]);
      mockRepo.markManyAsRead.mockResolvedValue(4);

      await service.markManyAsRead(['a', 'b', 'c', 'd'], 'user-1');

      expect(mockRedisClient.del).toHaveBeenCalledWith(
        UNREAD_ORG_CACHE_KEY('user-1', 'org-1'),
      );
      expect(mockRedisClient.del).toHaveBeenCalledWith(
        UNREAD_ORG_CACHE_KEY('user-1', 'org-2'),
      );
    });
  });

  // ── markAllAsRead ──────────────────────────────────────────────────────────

  describe('markAllAsRead', () => {
    it('updates all unread records and deletes both global and org Redis counters', async () => {
      mockRepo.markAllAsRead.mockResolvedValue(undefined);

      await service.markAllAsRead('user-1', 'org-1');

      expect(mockRepo.markAllAsRead).toHaveBeenCalledWith('user-1', 'org-1');
      expect(mockRedisClient.del).toHaveBeenCalledWith(
        UNREAD_CACHE_KEY('user-1'),
      );
      expect(mockRedisClient.del).toHaveBeenCalledWith(
        UNREAD_ORG_CACHE_KEY('user-1', 'org-1'),
      );
    });
  });

  // ── getUserNotifications ───────────────────────────────────────────────────

  describe('getUserNotifications', () => {
    it('returns paginated notifications ordered by createdAt desc', async () => {
      mockRepo.findByUser.mockResolvedValue([baseNotif]);

      const results = await service.getUserNotifications('user-1', 'org-1', {
        limit: 10,
        offset: 0,
      });

      expect(results).toHaveLength(1);
      expect(mockRepo.findByUser).toHaveBeenCalledWith('user-1', 'org-1', {
        limit: 10,
        offset: 0,
      });
    });

    it('filters by unreadOnly when option is set', async () => {
      mockRepo.findByUser.mockResolvedValue([]);

      await service.getUserNotifications('user-1', 'org-1', {
        unreadOnly: true,
      });

      expect(mockRepo.findByUser).toHaveBeenCalledWith('user-1', 'org-1', {
        unreadOnly: true,
      });
    });
  });

  // ── notifyUser ────────────────────────────────────────────────────────────

  describe('notifyUser', () => {
    it('creates a notification for a single user', async () => {
      const notif = { ...baseNotif };
      mockRepo.create.mockResolvedValue(notif);
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
      mockRepo.create.mockResolvedValue(baseNotif);
      mockRedisClient.incr.mockResolvedValue(1);
      mockRedisClient.expire.mockResolvedValue(1);
      mockPubSub.publishUserNotification.mockResolvedValue(undefined);

      const results = await service.notifyManyUsers(
        ['user-1', 'user-2', 'user-3'],
        'org-1',
        { type: 'info', title: 'Hi', body: 'World' },
      );

      expect(results).toHaveLength(3);
      expect(mockRepo.create).toHaveBeenCalledTimes(3);
    });
  });

  // ── deleteNotification ─────────────────────────────────────────────────────

  describe('deleteNotification', () => {
    it('deletes notification and decrements both global and org counters when unread', async () => {
      mockRepo.findByIdAndUser.mockResolvedValue(baseNotif);
      mockRepo.delete.mockResolvedValue(undefined);

      await service.deleteNotification('notif-uuid-1', 'user-1');

      expect(mockRedisClient.decrby).toHaveBeenCalledWith(
        UNREAD_CACHE_KEY('user-1'),
        1,
      );
      expect(mockRedisClient.decrby).toHaveBeenCalledWith(
        UNREAD_ORG_CACHE_KEY('user-1', 'org-1'),
        1,
      );
      expect(mockRepo.delete).toHaveBeenCalledWith('notif-uuid-1');
    });

    it('does not decrement counter when notification is already read', async () => {
      const readNotif = { ...baseNotif, readAt: NOW };
      mockRepo.findByIdAndUser.mockResolvedValue(readNotif);
      mockRepo.delete.mockResolvedValue(undefined);

      await service.deleteNotification('notif-uuid-1', 'user-1');

      expect(mockRedisClient.decrby).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when notification does not belong to user', async () => {
      mockRepo.findByIdAndUser.mockResolvedValue(null);

      await expect(
        service.deleteNotification('ghost-id', 'user-1'),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
