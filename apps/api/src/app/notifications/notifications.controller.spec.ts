import { Test, TestingModule } from '@nestjs/testing';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from '@libs/notifications';
import { JwtAuthGuard } from '@libs/common';
import { OrgContextGuard, RBACGuard } from '@libs/rbac';
import { MarkManyReadDto } from './dto/mark-many-read.dto';
import { QueryNotificationsDto } from './dto/query-notifications.dto';
import { vi } from 'vitest';

// Prevent Vitest from loading the full @libs/notifications module graph (which
// pulls in ioredis, socket.io, jwks-rsa — all ESM-only) and causing parse
// errors. The controller only needs NotificationsService as a DI token.
vi.mock('@libs/notifications', () => ({
  NotificationsService: class MockNotificationsService {},
}));

// ── Fixtures ──────────────────────────────────────────────────────────────────

const NOW = new Date('2026-01-01T12:00:00Z');

const ORG_ID = 'org-1';
const USER_ID = 'user-1';

const baseNotif = {
  id: 'notif-uuid-1',
  orgId: ORG_ID,
  userId: USER_ID,
  type: 'alert',
  title: 'Hello',
  body: 'World',
  metadata: null,
  readAt: null,
  createdAt: NOW,
};

// ── Mock service ──────────────────────────────────────────────────────────────

const mockService = {
  getUserNotifications: vi.fn(),
  getUnreadCount: vi.fn(),
  getUnreadCountForOrg: vi.fn(),
  createNotification: vi.fn(),
  markAsRead: vi.fn(),
  markManyAsRead: vi.fn(),
  deleteNotification: vi.fn(),
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('NotificationsController', () => {
  let controller: NotificationsController;

  beforeEach(async () => {
    vi.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [NotificationsController],
      providers: [{ provide: NotificationsService, useValue: mockService }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(OrgContextGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RBACGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get(NotificationsController);
  });

  // ── GET /organizations/:orgId/notifications ────────────────────────────────

  describe('getNotifications', () => {
    it('returns notifications for the authenticated user in the org', async () => {
      mockService.getUserNotifications.mockResolvedValue([baseNotif]);

      const query: QueryNotificationsDto = {
        limit: 10,
        offset: 0,
      };
      // New signature: getNotifications(userId, orgId, query)
      const result = await controller.getNotifications(USER_ID, ORG_ID, query);

      expect(result).toEqual([baseNotif]);
      expect(mockService.getUserNotifications).toHaveBeenCalledWith(
        USER_ID,
        ORG_ID,
        { limit: 10, offset: 0, unreadOnly: undefined },
      );
    });

    it('propagates service errors', async () => {
      mockService.getUserNotifications.mockRejectedValue(new Error('db error'));
      await expect(
        controller.getNotifications(USER_ID, ORG_ID, {}),
      ).rejects.toThrow('db error');
    });
  });

  // ── GET /organizations/:orgId/notifications/unread-count ───────────────────

  describe('getUnreadCount', () => {
    it('returns user-scoped unread count', async () => {
      mockService.getUnreadCount.mockResolvedValue(3);

      // New signature: getUnreadCount(userId) — no orgId
      const result = await controller.getUnreadCount(USER_ID);

      expect(result).toEqual({ count: 3 });
      expect(mockService.getUnreadCount).toHaveBeenCalledWith(USER_ID);
    });
  });

  // ── PATCH /notifications/:id/read ─────────────────────────────────────────

  describe('markAsRead', () => {
    it('marks the notification and returns the updated record', async () => {
      const updated = { ...baseNotif, readAt: NOW };
      mockService.markAsRead.mockResolvedValue(updated);

      const result = await controller.markAsRead('notif-uuid-1', USER_ID);

      expect(result.readAt).toBe(NOW);
      expect(mockService.markAsRead).toHaveBeenCalledWith(
        'notif-uuid-1',
        USER_ID,
      );
    });
  });

  // ── PATCH /organizations/:orgId/notifications/read ────────────────────────

  describe('markManyAsRead', () => {
    it('delegates to the service and returns nothing', async () => {
      mockService.markManyAsRead.mockResolvedValue(undefined);

      const dto: MarkManyReadDto = { ids: ['notif-1', 'notif-2'] };
      const result = await controller.markManyAsRead(dto, USER_ID);

      expect(result).toBeUndefined();
      expect(mockService.markManyAsRead).toHaveBeenCalledWith(
        ['notif-1', 'notif-2'],
        USER_ID,
      );
    });
  });

  // ── DELETE /organizations/:orgId/notifications/:id ────────────────────────

  describe('deleteNotification', () => {
    it('delegates to the service', async () => {
      mockService.deleteNotification.mockResolvedValue(undefined);

      await controller.deleteNotification('notif-uuid-1', USER_ID);

      expect(mockService.deleteNotification).toHaveBeenCalledWith(
        'notif-uuid-1',
        USER_ID,
      );
    });
  });
});
