import { Test, TestingModule } from '@nestjs/testing';
import { NotificationsGateway } from './notifications.gateway';
import { NotificationsService } from '../../data-access/notifications.service';
import { NotificationsPubSubService } from '../../data-access/notifications-pubsub.service';
import { PrismaBusinessService } from '@libs/prisma-business';
import { ConfigService } from '@nestjs/config';
import { Server } from 'socket.io';

// ── Redis adapter mock ────────────────────────────────────────────────────────
// Everything is defined inside the factory so it is available when the factory
// is invoked during the module-loading phase (after jest.mock hoisting).

jest.mock('ioredis', () => {
  const instance = {
    duplicate: jest.fn().mockReturnThis(),
    on: jest.fn(),
    quit: jest.fn().mockResolvedValue('OK'),
  };
  const Ctor: any = jest.fn(() => instance);
  Ctor.__instance = instance;
  return { __esModule: true, default: Ctor };
});

jest.mock('@socket.io/redis-adapter', () => ({
  createAdapter: jest.fn().mockReturnValue({}),
}));

// jwks-rsa pulls in jose (ESM-only) which Jest cannot parse without extra
// transform config. We mock the whole module because verifyToken is already
// exercised via jest.spyOn in the individual tests below.
jest.mock('jwks-rsa', () => ({
  JwksClient: jest.fn().mockImplementation(() => ({
    getSigningKey: jest.fn(),
  })),
}));

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockPubSub = {
  subscribeToUserPattern: jest.fn(),
  subscribeToOrgPattern: jest.fn(),
  subscribeToGlobal: jest.fn(),
};

const mockNotificationsService = {
  getUserNotifications: jest.fn().mockResolvedValue([]),
  markAsRead: jest.fn().mockResolvedValue({}),
  markAllAsRead: jest.fn().mockResolvedValue(undefined),
  getUnreadCount: jest.fn().mockResolvedValue(2),
};

const mockPrisma = {
  user: { findUnique: jest.fn() },
  membership: { findMany: jest.fn() },
};

const mockConfig = {
  get: jest.fn().mockImplementation((key: string) => {
    const map: Record<string, string> = {
      'auth.audience': 'https://api.test',
      'auth.issuer': 'https://test.auth0.local/',
      'auth.jwksUri': 'https://test.auth0.local/.well-known/jwks.json',
    };
    return map[key] ?? '';
  }),
};

// ── Helper — minimal Socket stub ─────────────────────────────────────────────

function makeSocket(
  overrides: Partial<{ userId: string; handshake: object }> = {},
) {
  return {
    id: 'socket-1',
    userId: overrides.userId,
    email: undefined as string | undefined,
    handshake: overrides.handshake ?? {
      auth: { token: 'Bearer test.token.value' },
      query: {},
      headers: {},
    },
    join: jest.fn().mockResolvedValue(undefined),
    disconnect: jest.fn(),
    emit: jest.fn(),
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('NotificationsGateway', () => {
  let gateway: NotificationsGateway;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationsGateway,
        { provide: NotificationsPubSubService, useValue: mockPubSub },
        { provide: NotificationsService, useValue: mockNotificationsService },
        { provide: PrismaBusinessService, useValue: mockPrisma },
        { provide: ConfigService, useValue: mockConfig },
      ],
    }).compile();

    gateway = module.get(NotificationsGateway);
  });

  // ── afterInit ──────────────────────────────────────────────────────────────

  describe('afterInit', () => {
    it('registers all three Redis subscription handlers', () => {
      const mockServer = { adapter: jest.fn() } as unknown as Server;
      gateway.afterInit(mockServer);

      expect(mockPubSub.subscribeToUserPattern).toHaveBeenCalledTimes(1);
      expect(mockPubSub.subscribeToOrgPattern).toHaveBeenCalledTimes(1);
      expect(mockPubSub.subscribeToGlobal).toHaveBeenCalledTimes(1);
    });

    it('attaches the Redis adapter to the server', () => {
      const mockServer = { adapter: jest.fn() } as unknown as Server;
      gateway.afterInit(mockServer);

      expect(mockServer.adapter).toHaveBeenCalledTimes(1);
    });
  });

  // ── handleConnection ───────────────────────────────────────────────────────

  describe('handleConnection', () => {
    it('disconnects the socket when no token is provided', async () => {
      const client = makeSocket({
        handshake: { auth: {}, query: {}, headers: {} },
      });

      await gateway.handleConnection(client as never);

      expect(client.disconnect).toHaveBeenCalled();
    });

    it('disconnects when the token cannot be verified', async () => {
      // verifyToken will reject because we stub it with an invalid token.
      jest
        .spyOn(gateway as any, 'verifyToken')
        .mockRejectedValue(new Error('invalid signature'));

      const client = makeSocket();

      await gateway.handleConnection(client as never);

      expect(client.disconnect).toHaveBeenCalled();
    });

    it('disconnects when the user is not found in the DB', async () => {
      jest
        .spyOn(gateway as any, 'verifyToken')
        .mockResolvedValue({ sub: 'auth0|unknown' });

      mockPrisma.user.findUnique.mockResolvedValue(null);

      const client = makeSocket();
      await gateway.handleConnection(client as never);

      expect(client.disconnect).toHaveBeenCalled();
    });

    it('joins user/org rooms and emits unread count on success', async () => {
      jest
        .spyOn(gateway as any, 'verifyToken')
        .mockResolvedValue({ sub: 'auth0|user-1' });

      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'user-uuid-1',
        email: 'user@test.com',
        auth0Id: 'auth0|user-1',
      });

      mockPrisma.membership.findMany.mockResolvedValue([
        { orgId: 'org-a' },
        { orgId: 'org-b' },
      ]);

      mockNotificationsService.getUnreadCount.mockResolvedValue(5);

      const client = makeSocket();
      await gateway.handleConnection(client as never);

      expect(client.join).toHaveBeenCalledWith('user:user-uuid-1');
      expect(client.join).toHaveBeenCalledWith('org:org-a');
      expect(client.join).toHaveBeenCalledWith('org:org-b');
      expect(client.emit).toHaveBeenCalledWith('notification:unread-count', {
        count: 5,
      });
      expect(client.disconnect).not.toHaveBeenCalled();
    });
  });

  // ── handleDisconnect ───────────────────────────────────────────────────────

  describe('handleDisconnect', () => {
    it('removes the socket from the userSockets map', async () => {
      // Connect first so the map gets an entry.
      jest
        .spyOn(gateway as any, 'verifyToken')
        .mockResolvedValue({ sub: 'auth0|user-1' });

      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'user-uuid-1',
        email: 'user@test.com',
        auth0Id: 'auth0|user-1',
      });
      mockPrisma.membership.findMany.mockResolvedValue([]);

      const client = makeSocket();
      await gateway.handleConnection(client as never);

      // Now disconnect.
      gateway.handleDisconnect({ ...client, userId: 'user-uuid-1' } as never);

      // The internal map should be empty.
      const map = (
        gateway as unknown as { userSockets: Map<string, Set<string>> }
      ).userSockets;
      expect(map.has('user-uuid-1')).toBe(false);
    });
  });

  // ── handleMarkRead ─────────────────────────────────────────────────────────

  describe('handleMarkRead', () => {
    it('delegates to service and emits updated count', async () => {
      mockNotificationsService.getUnreadCount.mockResolvedValue(1);

      const client = makeSocket({ userId: 'user-uuid-1' });
      await gateway.handleMarkRead(client as never, {
        notificationId: 'notif-1',
      });

      expect(mockNotificationsService.markAsRead).toHaveBeenCalledWith(
        'notif-1',
        'user-uuid-1',
      );
      expect(client.emit).toHaveBeenCalledWith('notification:unread-count', {
        count: 1,
      });
    });
  });

  // ── handleMarkAllRead ──────────────────────────────────────────────────────

  describe('handleMarkAllRead', () => {
    it('delegates to service and emits zero count', async () => {
      const client = makeSocket({ userId: 'user-uuid-1' });
      await gateway.handleMarkAllRead(client as never, { orgId: 'org-1' });

      expect(mockNotificationsService.markAllAsRead).toHaveBeenCalledWith(
        'user-uuid-1',
        'org-1',
      );
      expect(client.emit).toHaveBeenCalledWith('notification:unread-count', {
        count: 0,
      });
    });

    it('does nothing when userId is missing', async () => {
      const client = makeSocket(); // no userId
      await gateway.handleMarkAllRead(client as never, { orgId: 'org-1' });
      expect(mockNotificationsService.markAllAsRead).not.toHaveBeenCalled();
    });
  });

  // ── handleGetAll ───────────────────────────────────────────────────────────

  describe('handleGetAll', () => {
    it('emits notification:list when userId is set', async () => {
      const notifs = [{ id: 'n1' }];
      mockNotificationsService.getUserNotifications.mockResolvedValue(notifs);

      const client = makeSocket({ userId: 'user-uuid-1' });
      await gateway.handleGetAll(client as never, { orgId: 'org-1' });

      expect(mockNotificationsService.getUserNotifications).toHaveBeenCalledWith(
        'user-uuid-1',
        'org-1',
        expect.any(Object),
      );
      expect(client.emit).toHaveBeenCalledWith('notification:list', notifs);
    });

    it('does nothing when userId is missing', async () => {
      const client = makeSocket();
      await gateway.handleGetAll(client as never, { orgId: 'org-1' });
      expect(mockNotificationsService.getUserNotifications).not.toHaveBeenCalled();
    });
  });

  // ── handleMarkRead guards ──────────────────────────────────────────────────

  describe('handleMarkRead guards', () => {
    it('does nothing when userId is missing', async () => {
      const client = makeSocket();
      await gateway.handleMarkRead(client as never, { notificationId: 'n1' });
      expect(mockNotificationsService.markAsRead).not.toHaveBeenCalled();
    });

    it('does nothing when notificationId is missing', async () => {
      const client = makeSocket({ userId: 'user-uuid-1' });
      await gateway.handleMarkRead(client as never, {} as any);
      expect(mockNotificationsService.markAsRead).not.toHaveBeenCalled();
    });
  });

  // ── Redis → Socket.IO bridge methods ──────────────────────────────────────

  describe('notification message bridges', () => {
    const buildEvent = (overrides = {}) => ({
      scope: 'user' as const,
      timestamp: new Date().toISOString(),
      payload: {
        notificationId: 'n1',
        userId: 'user-42',
        orgId: 'org-99',
        type: 'info',
        title: 'T',
        body: 'B',
        metadata: null,
        createdAt: new Date(),
        ...overrides,
      },
    });

    it('afterInit invokes subscribeToUserPattern and the callback emits to user room', () => {
      let capturedHandler: ((e: any) => void) | null = null;
      mockPubSub.subscribeToUserPattern.mockImplementation((cb: (e: any) => void) => {
        capturedHandler = cb;
      });

      const mockServer = { adapter: jest.fn(), to: jest.fn().mockReturnThis(), emit: jest.fn() } as unknown as import('socket.io').Server;
      (gateway as any).server = mockServer;
      gateway.afterInit(mockServer);

      expect(capturedHandler).not.toBeNull();
      capturedHandler!(buildEvent());

      expect(mockServer.to).toHaveBeenCalledWith('user:user-42');
      expect((mockServer.to('') as any).emit).toHaveBeenCalledWith(
        'notification:new',
        expect.objectContaining({ userId: 'user-42' }),
      );
    });

    it('afterInit invokes subscribeToOrgPattern and the callback emits to org room', () => {
      let capturedHandler: ((e: any) => void) | null = null;
      mockPubSub.subscribeToOrgPattern.mockImplementation((cb: (e: any) => void) => {
        capturedHandler = cb;
      });

      const mockServer = { adapter: jest.fn(), to: jest.fn().mockReturnThis(), emit: jest.fn() } as unknown as import('socket.io').Server;
      (gateway as any).server = mockServer;
      gateway.afterInit(mockServer);

      capturedHandler!(buildEvent({ orgId: 'org-99' }));

      expect(mockServer.to).toHaveBeenCalledWith('org:org-99');
    });

    it('afterInit invokes subscribeToGlobal and the callback broadcasts', () => {
      let capturedHandler: ((e: any) => void) | null = null;
      mockPubSub.subscribeToGlobal.mockImplementation((cb: (e: any) => void) => {
        capturedHandler = cb;
      });

      const mockServer = { adapter: jest.fn(), to: jest.fn().mockReturnThis(), emit: jest.fn() } as unknown as import('socket.io').Server;
      (gateway as any).server = mockServer;
      gateway.afterInit(mockServer);

      capturedHandler!(buildEvent());

      expect(mockServer.emit).toHaveBeenCalledWith(
        'notification:new',
        expect.objectContaining({ userId: 'user-42' }),
      );
    });
  });

  // ── extractToken ───────────────────────────────────────────────────────────

  describe('extractToken (private, accessed via handleConnection)', () => {
    it('extracts token from handshake.query.token', async () => {
      jest
        .spyOn(gateway as any, 'verifyToken')
        .mockResolvedValue({ sub: 'auth0|user-1' });
      mockPrisma.user.findUnique.mockResolvedValue(null); // disconnect after verify

      const client = makeSocket({
        handshake: { auth: {}, query: { token: 'query-token' }, headers: {} },
      });
      await gateway.handleConnection(client as never);

      expect(
        (gateway as any).verifyToken,
      ).toHaveBeenCalledWith('query-token');
    });

    it('extracts token from handshake.headers.authorization', async () => {
      jest
        .spyOn(gateway as any, 'verifyToken')
        .mockResolvedValue({ sub: 'auth0|user-1' });
      mockPrisma.user.findUnique.mockResolvedValue(null);

      const client = makeSocket({
        handshake: {
          auth: {},
          query: {},
          headers: { authorization: 'Bearer header-token' },
        },
      });
      await gateway.handleConnection(client as never);

      expect(
        (gateway as any).verifyToken,
      ).toHaveBeenCalledWith('header-token');
    });

    it('disconnects when payload has no sub claim', async () => {
      jest
        .spyOn(gateway as any, 'verifyToken')
        .mockResolvedValue({ sub: undefined });

      const client = makeSocket();
      await gateway.handleConnection(client as never);

      expect(client.disconnect).toHaveBeenCalled();
    });
  });
});
