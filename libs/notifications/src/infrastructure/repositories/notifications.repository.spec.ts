import { PrismaBusinessService } from '@libs/prisma-business';
import { vi } from 'vitest';
import { NotificationsRepository } from './notifications.repository';

// ── Prisma mock ──────────────────────────────────────────────────────────────

const mockPrisma = {
  notification: {
    create: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
    findFirst: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    delete: vi.fn(),
  },
  user: {
    findUnique: vi.fn(),
  },
  membership: {
    findMany: vi.fn(),
  },
} as unknown as PrismaBusinessService;

// ── Fixture ───────────────────────────────────────────────────────────────────

const baseNotification = {
  id: 'notif-1',
  orgId: 'org-1',
  userId: 'user-1',
  type: 'info',
  title: 'Hello',
  body: 'World',
  metadata: null,
  readAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('NotificationsRepository', () => {
  let repo: NotificationsRepository;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = new NotificationsRepository(mockPrisma);
  });

  // ── create ──────────────────────────────────────────────────────────────────

  describe('create', () => {
    it('creates a notification with metadata', async () => {
      mockPrisma.notification.create = vi
        .fn()
        .mockResolvedValue(baseNotification);

      const result = await repo.create({
        orgId: 'org-1',
        userId: 'user-1',
        type: 'info',
        title: 'Hello',
        body: 'World',
        metadata: { key: 'value' },
      });

      expect(result).toBe(baseNotification);
      expect(mockPrisma.notification.create).toHaveBeenCalledWith({
        data: {
          orgId: 'org-1',
          userId: 'user-1',
          type: 'info',
          title: 'Hello',
          body: 'World',
          metadata: { key: 'value' },
        },
      });
    });

    it('creates a notification without metadata (undefined when null)', async () => {
      mockPrisma.notification.create = vi
        .fn()
        .mockResolvedValue(baseNotification);

      await repo.create({
        orgId: 'org-1',
        userId: 'user-1',
        type: 'info',
        title: 'Hello',
        body: 'World',
        metadata: null,
      });

      expect(mockPrisma.notification.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ metadata: undefined }),
      });
    });
  });

  // ── findByUser ──────────────────────────────────────────────────────────────

  describe('findByUser', () => {
    it('returns notifications with default options', async () => {
      mockPrisma.notification.findMany = vi
        .fn()
        .mockResolvedValue([baseNotification]);

      const result = await repo.findByUser('user-1', 'org-1');

      expect(result).toEqual([baseNotification]);
      expect(mockPrisma.notification.findMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', orgId: 'org-1' },
        orderBy: { createdAt: 'desc' },
        take: 20,
        skip: 0,
      });
    });

    it('applies unreadOnly filter when set', async () => {
      mockPrisma.notification.findMany = vi.fn().mockResolvedValue([]);

      await repo.findByUser('user-1', 'org-1', {
        limit: 10,
        offset: 5,
        unreadOnly: true,
      });

      expect(mockPrisma.notification.findMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', orgId: 'org-1', readAt: null },
        orderBy: { createdAt: 'desc' },
        take: 10,
        skip: 5,
      });
    });
  });

  // ── countUnread ──────────────────────────────────────────────────────────────

  describe('countUnread', () => {
    it('counts unread notifications for user', async () => {
      mockPrisma.notification.count = vi.fn().mockResolvedValue(3);

      const result = await repo.countUnread('user-1');

      expect(result).toBe(3);
      expect(mockPrisma.notification.count).toHaveBeenCalledWith({
        where: { userId: 'user-1', readAt: null },
      });
    });
  });

  // ── findUnreadByIdAndUser ─────────────────────────────────────────────────────

  describe('findUnreadByIdAndUser', () => {
    it('returns the notification when found and unread', async () => {
      mockPrisma.notification.findFirst = vi
        .fn()
        .mockResolvedValue(baseNotification);

      const result = await repo.findUnreadByIdAndUser('notif-1', 'user-1');

      expect(result).toBe(baseNotification);
      expect(mockPrisma.notification.findFirst).toHaveBeenCalledWith({
        where: { id: 'notif-1', userId: 'user-1', readAt: null },
      });
    });

    it('returns null when notification not found', async () => {
      mockPrisma.notification.findFirst = vi.fn().mockResolvedValue(null);

      const result = await repo.findUnreadByIdAndUser('notif-x', 'user-1');

      expect(result).toBeNull();
    });
  });

  // ── markAsRead ───────────────────────────────────────────────────────────────

  describe('markAsRead', () => {
    it('marks a single notification as read', async () => {
      const readNotif = { ...baseNotification, readAt: new Date() };
      mockPrisma.notification.update = vi.fn().mockResolvedValue(readNotif);

      const result = await repo.markAsRead('notif-1');

      expect(result).toBe(readNotif);
      expect(mockPrisma.notification.update).toHaveBeenCalledWith({
        where: { id: 'notif-1' },
        data: { readAt: expect.any(Date) },
      });
    });
  });

  // ── markManyAsRead ───────────────────────────────────────────────────────────

  describe('markManyAsRead', () => {
    it('bulk-marks multiple notifications as read and returns count', async () => {
      mockPrisma.notification.updateMany = vi
        .fn()
        .mockResolvedValue({ count: 2 });

      const result = await repo.markManyAsRead(
        ['notif-1', 'notif-2'],
        'user-1',
      );

      expect(result).toBe(2);
      expect(mockPrisma.notification.updateMany).toHaveBeenCalledWith({
        where: {
          id: { in: ['notif-1', 'notif-2'] },
          userId: 'user-1',
          readAt: null,
        },
        data: { readAt: expect.any(Date) },
      });
    });
  });

  // ── markAllAsRead ─────────────────────────────────────────────────────────────

  describe('markAllAsRead', () => {
    it('marks all notifications as read for user+org', async () => {
      mockPrisma.notification.updateMany = vi
        .fn()
        .mockResolvedValue({ count: 5 });

      await repo.markAllAsRead('user-1', 'org-1');

      expect(mockPrisma.notification.updateMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', orgId: 'org-1', readAt: null },
        data: { readAt: expect.any(Date) },
      });
    });
  });

  // ── findByIdAndUser ───────────────────────────────────────────────────────────

  describe('findByIdAndUser', () => {
    it('returns the notification when found', async () => {
      mockPrisma.notification.findFirst = vi
        .fn()
        .mockResolvedValue(baseNotification);

      const result = await repo.findByIdAndUser('notif-1', 'user-1');

      expect(result).toBe(baseNotification);
      expect(mockPrisma.notification.findFirst).toHaveBeenCalledWith({
        where: { id: 'notif-1', userId: 'user-1' },
      });
    });

    it('returns null when not found', async () => {
      mockPrisma.notification.findFirst = vi.fn().mockResolvedValue(null);

      const result = await repo.findByIdAndUser('notif-x', 'user-1');

      expect(result).toBeNull();
    });
  });

  // ── delete ────────────────────────────────────────────────────────────────────

  describe('delete', () => {
    it('deletes the notification by id', async () => {
      mockPrisma.notification.delete = vi
        .fn()
        .mockResolvedValue(baseNotification);

      await repo.delete('notif-1');

      expect(mockPrisma.notification.delete).toHaveBeenCalledWith({
        where: { id: 'notif-1' },
      });
    });
  });

  // ── findUserByAuth0Id ─────────────────────────────────────────────────────────

  describe('findUserByAuth0Id', () => {
    it('returns user id and email when found', async () => {
      const user = { id: 'user-uuid-1', email: 'user@test.com' };
      mockPrisma.user.findUnique = vi.fn().mockResolvedValue(user);

      const result = await repo.findUserByAuth0Id('auth0|user-1');

      expect(result).toEqual(user);
      expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
        where: { auth0Id: 'auth0|user-1' },
        select: { id: true, email: true },
      });
    });

    it('returns null when user not found', async () => {
      mockPrisma.user.findUnique = vi.fn().mockResolvedValue(null);

      const result = await repo.findUserByAuth0Id('auth0|unknown');

      expect(result).toBeNull();
    });
  });

  // ── findActiveOrgMemberships ──────────────────────────────────────────────────

  describe('findActiveOrgMemberships', () => {
    it('returns orgIds for all active memberships', async () => {
      const memberships = [{ orgId: 'org-a' }, { orgId: 'org-b' }];
      mockPrisma.membership.findMany = vi.fn().mockResolvedValue(memberships);

      const result = await repo.findActiveOrgMemberships('user-uuid-1');

      expect(result).toEqual(memberships);
      expect(mockPrisma.membership.findMany).toHaveBeenCalledWith({
        where: { userId: 'user-uuid-1', status: 'ACTIVE' },
        select: { orgId: true },
      });
    });

    it('returns empty array when no active memberships exist', async () => {
      mockPrisma.membership.findMany = vi.fn().mockResolvedValue([]);

      const result = await repo.findActiveOrgMemberships('user-uuid-1');

      expect(result).toEqual([]);
    });
  });
});
