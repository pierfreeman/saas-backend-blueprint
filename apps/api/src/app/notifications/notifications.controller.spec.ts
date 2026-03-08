import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from '@libs/notifications';
import { JwtAuthGuard, RequestUser } from '@libs/common';
import { AuthService } from '../auth/auth.service';
import { CreateNotificationDto } from './dto/create-notification.dto';
import { MarkManyReadDto } from './dto/mark-many-read.dto';
import { QueryNotificationsDto } from './dto/query-notifications.dto';

// Prevent Jest from loading the full @libs/notifications module graph (which
// pulls in ioredis, socket.io, jwks-rsa — all ESM-only) and causing parse
// errors. The controller only needs NotificationsService as a DI token.
jest.mock('@libs/notifications', () => ({
  NotificationsService: class MockNotificationsService {},
}));

// AuthService is a plain NestJS class — no ESM issues. Mock at module level
// so imports are resolved without PrismaBusinessService transitive deps.
jest.mock('../auth/auth.service');

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

// Return `any` so the stub is accepted by all controller method signatures
// without needing to replicate the non-exported AuthenticatedRequest interface.
function makeReq(sub = 'user-1'): any {
  return { user: { sub, email: 'user@test.com' } as RequestUser };
}

// ── Mock service ──────────────────────────────────────────────────────────────

const mockService = {
  getUserNotifications: jest.fn(),
  getUnreadCount: jest.fn(),
  createNotification: jest.fn(),
  markAsRead: jest.fn(),
  markManyAsRead: jest.fn(),
  deleteNotification: jest.fn(),
};

// findUserByAuth0Id resolves sub → { id: sub } so service assertions keep
// matching the sub value used in makeReq() calls.
const mockAuthService = {
  findUserByAuth0Id: jest.fn((sub: string) => Promise.resolve({ id: sub })),
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('NotificationsController', () => {
  let controller: NotificationsController;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [NotificationsController],
      providers: [
        { provide: NotificationsService, useValue: mockService },
        { provide: AuthService, useValue: mockAuthService },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get(NotificationsController);
  });

  // ── GET /notifications ──────────────────────────────────────────────────────

  describe('getNotifications', () => {
    it('returns notifications for the authenticated user', async () => {
      mockService.getUserNotifications.mockResolvedValue([baseNotif]);

      const query: QueryNotificationsDto = {
        orgId: 'org-1',
        limit: 10,
        offset: 0,
      };
      const result = await controller.getNotifications(makeReq(), query);

      expect(result).toEqual([baseNotif]);
      expect(mockService.getUserNotifications).toHaveBeenCalledWith(
        'user-1',
        'org-1',
        { limit: 10, offset: 0, unreadOnly: undefined },
      );
    });

    it('passes empty orgId when not provided', async () => {
      mockService.getUserNotifications.mockResolvedValue([]);

      await controller.getNotifications(makeReq(), {});

      expect(mockService.getUserNotifications).toHaveBeenCalledWith(
        'user-1',
        '',
        expect.any(Object),
      );
    });
  });

  // ── GET /notifications/unread-count ────────────────────────────────────────

  describe('getUnreadCount', () => {
    it('returns the unread count wrapped in an object', async () => {
      mockService.getUnreadCount.mockResolvedValue(7);

      const result = await controller.getUnreadCount(makeReq());

      expect(result).toEqual({ count: 7 });
      expect(mockService.getUnreadCount).toHaveBeenCalledWith('user-1');
    });
  });

  // ── POST /notifications ─────────────────────────────────────────────────────

  describe('createNotification', () => {
    it('creates a notification and returns it', async () => {
      mockService.createNotification.mockResolvedValue(baseNotif);

      const dto: CreateNotificationDto = {
        orgId: 'org-1',
        userId: 'user-1',
        type: 'alert',
        title: 'Hello',
        body: 'World',
      };

      const result = await controller.createNotification(dto);

      expect(result).toEqual(baseNotif);
      expect(mockService.createNotification).toHaveBeenCalledWith(
        expect.objectContaining({ orgId: 'org-1', userId: 'user-1' }),
      );
    });
  });

  // ── PATCH /notifications/:id/read ──────────────────────────────────────────

  describe('markAsRead', () => {
    it('marks the notification and returns the updated record', async () => {
      const updated = { ...baseNotif, readAt: NOW };
      mockService.markAsRead.mockResolvedValue(updated);

      const result = await controller.markAsRead('notif-uuid-1', makeReq());

      expect(result.readAt).toBe(NOW);
      expect(mockService.markAsRead).toHaveBeenCalledWith(
        'notif-uuid-1',
        'user-1',
      );
    });

    it('propagates NotFoundException from the service', async () => {
      mockService.markAsRead.mockRejectedValue(new NotFoundException());

      await expect(
        controller.markAsRead('ghost-id', makeReq()),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ── PATCH /notifications/read ───────────────────────────────────────────────

  describe('markManyAsRead', () => {
    it('delegates to the service and returns nothing', async () => {
      mockService.markManyAsRead.mockResolvedValue(undefined);

      const dto: MarkManyReadDto = { ids: ['notif-1', 'notif-2'] };
      const result = await controller.markManyAsRead(dto, makeReq());

      expect(result).toBeUndefined();
      expect(mockService.markManyAsRead).toHaveBeenCalledWith(
        ['notif-1', 'notif-2'],
        'user-1',
      );
    });
  });

  // ── DELETE /notifications/:id ───────────────────────────────────────────────

  describe('deleteNotification', () => {
    it('delegates to the service', async () => {
      mockService.deleteNotification.mockResolvedValue(undefined);

      await controller.deleteNotification('notif-uuid-1', makeReq());

      expect(mockService.deleteNotification).toHaveBeenCalledWith(
        'notif-uuid-1',
        'user-1',
      );
    });
  });
});
