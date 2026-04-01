import { Test, TestingModule } from '@nestjs/testing';
import { NotificationsGateway } from './notifications.gateway';
import { NotificationsService } from '../../application/services/notifications.service';
import { NotificationsPubSubService } from '../../application/services/notifications-pubsub.service';
import { NotificationsRepository } from '../../infrastructure/repositories/notifications.repository';
import { ConfigService } from '@nestjs/config';
import { Server } from 'socket.io';
import * as jwt from 'jsonwebtoken';
import { vi } from 'vitest';

// ── Redis adapter mock ────────────────────────────────────────────────────────
// Everything is defined inside the factory so it is available when the factory
// is invoked during the module-loading phase (after vi.mock hoisting).

vi.mock('ioredis', () => {
  const instance = {
    duplicate: vi.fn().mockReturnThis(),
    on: vi.fn(),
    quit: vi.fn().mockResolvedValue('OK'),
  };
  const Ctor: any = vi.fn(function (this: any) {
    return instance;
  });
  Ctor.__instance = instance;
  return { __esModule: true, default: Ctor };
});

vi.mock('@socket.io/redis-adapter', () => ({
  createAdapter: vi.fn().mockReturnValue({}),
}));

// jwks-rsa pulls in jose (ESM-only) which Vitest cannot parse without extra
// transform config. We mock the whole module because verifyToken is already
// exercised via vi.spyOn in the individual tests below.
vi.mock('jwks-rsa', () => ({
  JwksClient: vi.fn(function (this: unknown) {
    return { getSigningKey: vi.fn() };
  }),
}));

vi.mock('jsonwebtoken', () => ({
  verify: vi.fn(),
}));

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockPubSub = {
  subscribeToUserPattern: vi.fn(),
  subscribeToOrgPattern: vi.fn(),
  subscribeToGlobal: vi.fn(),
};

const mockNotificationsService = {
  getUserNotifications: vi.fn().mockResolvedValue([]),
  markAsRead: vi.fn().mockResolvedValue({ orgId: 'org-1' }),
  markAllAsRead: vi.fn().mockResolvedValue(undefined),
  getUnreadCount: vi.fn().mockResolvedValue(2),
  getUnreadCountForOrg: vi.fn().mockResolvedValue(2),
};

const mockRepo = {
  findUserByAuth0Id: vi.fn(),
  findActiveOrgMemberships: vi.fn(),
};

const mockConfig = {
  get: vi.fn().mockImplementation((key: string) => {
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
    join: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn(),
    emit: vi.fn(),
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('NotificationsGateway', () => {
  let gateway: NotificationsGateway;

  beforeEach(async () => {
    vi.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationsGateway,
        { provide: NotificationsPubSubService, useValue: mockPubSub },
        { provide: NotificationsService, useValue: mockNotificationsService },
        { provide: NotificationsRepository, useValue: mockRepo },
        { provide: ConfigService, useValue: mockConfig },
      ],
    }).compile();

    gateway = module.get(NotificationsGateway);
  });

  // ── afterInit ──────────────────────────────────────────────────────────────

  describe('afterInit', () => {
    it('registers all three Redis subscription handlers', () => {
      const mockServer = { adapter: vi.fn() } as unknown as Server;
      gateway.afterInit(mockServer);

      expect(mockPubSub.subscribeToUserPattern).toHaveBeenCalledTimes(1);
      expect(mockPubSub.subscribeToOrgPattern).toHaveBeenCalledTimes(1);
      expect(mockPubSub.subscribeToGlobal).toHaveBeenCalledTimes(1);
    });

    it('attaches the Redis adapter to the server', () => {
      const mockServer = { adapter: vi.fn() } as unknown as Server;
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
      vi.spyOn(gateway as any, 'verifyToken').mockRejectedValue(
        new Error('invalid signature'),
      );

      const client = makeSocket();

      await gateway.handleConnection(client as never);

      expect(client.disconnect).toHaveBeenCalled();
    });

    it('disconnects when the user is not found in the DB', async () => {
      vi.spyOn(gateway as any, 'verifyToken').mockResolvedValue({
        sub: 'auth0|unknown',
      });

      mockRepo.findUserByAuth0Id.mockResolvedValue(null);

      const client = makeSocket();
      await gateway.handleConnection(client as never);

      expect(client.disconnect).toHaveBeenCalled();
    });

    it('joins user/org rooms and emits org-scoped unread count on success', async () => {
      vi.spyOn(gateway as any, 'verifyToken').mockResolvedValue({
        sub: 'auth0|user-1',
      });

      mockRepo.findUserByAuth0Id.mockResolvedValue({
        id: 'user-uuid-1',
        email: 'user@test.com',
        auth0Id: 'auth0|user-1',
      });

      mockRepo.findActiveOrgMemberships.mockResolvedValue([
        { orgId: 'org-a' },
        { orgId: 'org-b' },
      ]);

      mockNotificationsService.getUnreadCountForOrg.mockResolvedValue(5);

      const client = makeSocket({
        handshake: {
          auth: { token: 'Bearer test.token.value', orgId: 'org-a' },
          query: {},
          headers: {},
        },
      });
      await gateway.handleConnection(client as never);

      expect(client.join).toHaveBeenCalledWith('user:user-uuid-1');
      expect(client.join).toHaveBeenCalledWith('org:org-a');
      expect(client.join).toHaveBeenCalledWith('org:org-b');
      expect(client.emit).toHaveBeenCalledWith('notification:unread-count', {
        count: 5,
        orgId: 'org-a',
      });
      expect(client.disconnect).not.toHaveBeenCalled();
    });

    it('emits global unread count when no orgId in handshake', async () => {
      vi.spyOn(gateway as any, 'verifyToken').mockResolvedValue({
        sub: 'auth0|user-1',
      });

      mockRepo.findUserByAuth0Id.mockResolvedValue({
        id: 'user-uuid-1',
        email: 'user@test.com',
        auth0Id: 'auth0|user-1',
      });

      mockRepo.findActiveOrgMemberships.mockResolvedValue([]);
      mockNotificationsService.getUnreadCount.mockResolvedValue(3);

      const client = makeSocket();
      await gateway.handleConnection(client as never);

      expect(client.emit).toHaveBeenCalledWith('notification:unread-count', {
        count: 3,
      });
    });
  });

  // ── handleDisconnect ───────────────────────────────────────────────────────

  describe('handleDisconnect', () => {
    it('removes the socket from the userSockets map', async () => {
      // Connect first so the map gets an entry.
      vi.spyOn(gateway as any, 'verifyToken').mockResolvedValue({
        sub: 'auth0|user-1',
      });

      mockRepo.findUserByAuth0Id.mockResolvedValue({
        id: 'user-uuid-1',
        email: 'user@test.com',
        auth0Id: 'auth0|user-1',
      });
      mockRepo.findActiveOrgMemberships.mockResolvedValue([]);

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
    it('delegates to service and emits org-scoped updated count', async () => {
      mockNotificationsService.markAsRead.mockResolvedValue({ orgId: 'org-1' });
      mockNotificationsService.getUnreadCountForOrg.mockResolvedValue(1);

      const client = makeSocket({ userId: 'user-uuid-1' });
      await gateway.handleMarkRead(client as never, {
        notificationId: 'notif-1',
      });

      expect(mockNotificationsService.markAsRead).toHaveBeenCalledWith(
        'notif-1',
        'user-uuid-1',
      );
      expect(
        mockNotificationsService.getUnreadCountForOrg,
      ).toHaveBeenCalledWith('user-uuid-1', 'org-1');
      expect(client.emit).toHaveBeenCalledWith('notification:unread-count', {
        count: 1,
        orgId: 'org-1',
      });
    });
  });

  // ── handleMarkAllRead ──────────────────────────────────────────────────────

  describe('handleMarkAllRead', () => {
    it('delegates to service and emits recalculated org-scoped count', async () => {
      mockNotificationsService.getUnreadCountForOrg.mockResolvedValue(0);

      const client = makeSocket({ userId: 'user-uuid-1' });
      await gateway.handleMarkAllRead(client as never, { orgId: 'org-1' });

      expect(mockNotificationsService.markAllAsRead).toHaveBeenCalledWith(
        'user-uuid-1',
        'org-1',
      );
      expect(
        mockNotificationsService.getUnreadCountForOrg,
      ).toHaveBeenCalledWith('user-uuid-1', 'org-1');
      expect(client.emit).toHaveBeenCalledWith('notification:unread-count', {
        count: 0,
        orgId: 'org-1',
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

      expect(
        mockNotificationsService.getUserNotifications,
      ).toHaveBeenCalledWith('user-uuid-1', 'org-1', expect.any(Object));
      expect(client.emit).toHaveBeenCalledWith('notification:list', notifs);
    });

    it('does nothing when userId is missing', async () => {
      const client = makeSocket();
      await gateway.handleGetAll(client as never, { orgId: 'org-1' });
      expect(
        mockNotificationsService.getUserNotifications,
      ).not.toHaveBeenCalled();
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

    it('afterInit invokes subscribeToUserPattern and the callback emits to user room with unread count', async () => {
      let capturedHandler: ((e: any) => Promise<void>) | null = null;
      mockPubSub.subscribeToUserPattern.mockImplementation(
        (cb: (e: any) => Promise<void>) => {
          capturedHandler = cb;
        },
      );

      const mockEmit = vi.fn();
      const mockServer = {
        adapter: vi.fn(),
        to: vi.fn().mockReturnValue({ emit: mockEmit }),
        emit: vi.fn(),
      } as unknown as import('socket.io').Server;
      (gateway as any).server = mockServer;
      gateway.afterInit(mockServer);

      mockNotificationsService.getUnreadCountForOrg.mockResolvedValue(7);

      expect(capturedHandler).not.toBeNull();
      await capturedHandler!(buildEvent());

      expect(mockServer.to).toHaveBeenCalledWith('user:user-42');
      expect(mockEmit).toHaveBeenCalledWith(
        'notification:new',
        expect.objectContaining({ userId: 'user-42' }),
      );
      expect(
        mockNotificationsService.getUnreadCountForOrg,
      ).toHaveBeenCalledWith('user-42', 'org-99');
      expect(mockEmit).toHaveBeenCalledWith('notification:unread-count', {
        count: 7,
        orgId: 'org-99',
      });
    });

    it('afterInit invokes subscribeToOrgPattern and the callback emits to org and user rooms with unread count', async () => {
      let capturedHandler: ((e: any) => Promise<void>) | null = null;
      mockPubSub.subscribeToOrgPattern.mockImplementation(
        (cb: (e: any) => Promise<void>) => {
          capturedHandler = cb;
        },
      );

      const mockEmit = vi.fn();
      const mockServer = {
        adapter: vi.fn(),
        to: vi.fn().mockReturnValue({ emit: mockEmit }),
        emit: vi.fn(),
      } as unknown as import('socket.io').Server;
      (gateway as any).server = mockServer;
      gateway.afterInit(mockServer);

      mockNotificationsService.getUnreadCountForOrg.mockResolvedValue(4);

      await capturedHandler!(buildEvent({ orgId: 'org-99' }));

      expect(mockServer.to).toHaveBeenCalledWith('org:org-99');
      expect(mockEmit).toHaveBeenCalledWith(
        'notification:new',
        expect.objectContaining({ orgId: 'org-99' }),
      );
      expect(mockServer.to).toHaveBeenCalledWith('user:user-42');
      expect(mockEmit).toHaveBeenCalledWith('notification:unread-count', {
        count: 4,
        orgId: 'org-99',
      });
    });

    it('afterInit invokes subscribeToGlobal and the callback broadcasts with unread count', async () => {
      let capturedHandler: ((e: any) => Promise<void>) | null = null;
      mockPubSub.subscribeToGlobal.mockImplementation(
        (cb: (e: any) => Promise<void>) => {
          capturedHandler = cb;
        },
      );

      const mockEmit = vi.fn();
      const mockServer = {
        adapter: vi.fn(),
        to: vi.fn().mockReturnValue({ emit: mockEmit }),
        emit: vi.fn(),
      } as unknown as import('socket.io').Server;
      (gateway as any).server = mockServer;
      gateway.afterInit(mockServer);

      mockNotificationsService.getUnreadCountForOrg.mockResolvedValue(10);

      await capturedHandler!(buildEvent());

      expect(mockServer.emit).toHaveBeenCalledWith(
        'notification:new',
        expect.objectContaining({ userId: 'user-42' }),
      );
      expect(mockServer.to).toHaveBeenCalledWith('user:user-42');
      expect(mockEmit).toHaveBeenCalledWith('notification:unread-count', {
        count: 10,
        orgId: 'org-99',
      });
    });
  });

  // ── extractToken ───────────────────────────────────────────────────────────

  describe('extractToken (private, accessed via handleConnection)', () => {
    it('extracts token from handshake.query.token', async () => {
      vi.spyOn(gateway as any, 'verifyToken').mockResolvedValue({
        sub: 'auth0|user-1',
      });
      mockRepo.findUserByAuth0Id.mockResolvedValue(null); // disconnect after verify

      const client = makeSocket({
        handshake: { auth: {}, query: { token: 'query-token' }, headers: {} },
      });
      await gateway.handleConnection(client as never);

      expect((gateway as any).verifyToken).toHaveBeenCalledWith('query-token');
    });

    it('extracts token from handshake.headers.authorization', async () => {
      vi.spyOn(gateway as any, 'verifyToken').mockResolvedValue({
        sub: 'auth0|user-1',
      });
      mockRepo.findUserByAuth0Id.mockResolvedValue(null);

      const client = makeSocket({
        handshake: {
          auth: {},
          query: {},
          headers: { authorization: 'Bearer header-token' },
        },
      });
      await gateway.handleConnection(client as never);

      expect((gateway as any).verifyToken).toHaveBeenCalledWith('header-token');
    });

    it('disconnects when payload has no sub claim', async () => {
      vi.spyOn(gateway as any, 'verifyToken').mockResolvedValue({
        sub: undefined,
      });

      const client = makeSocket();
      await gateway.handleConnection(client as never);

      expect(client.disconnect).toHaveBeenCalled();
    });

    it('falls back through all undefined handshake sub-properties (lines 335/338/342)', async () => {
      // Covers the ?.auth, ?.query, ?.headers optional-chaining null branches.
      const client = makeSocket({
        handshake: { auth: undefined, query: undefined, headers: undefined },
      });
      await gateway.handleConnection(client as never);
      expect(client.disconnect).toHaveBeenCalled();
    });
  });

  // ── verifyToken internals (lines 358-378) ─────────────────────────────────

  describe('verifyToken internals (without spy)', () => {
    beforeEach(() => {
      // Restore gateway.verifyToken spy set by extractToken tests so the real
      // implementation runs; jwt.verify stays as the vi.mock vi.fn().
      vi.restoreAllMocks();
    });

    it('rejects when getSigningKey returns an error', async () => {
      const jwksError = new Error('JWKS fetch failed');
      (gateway as any).jwksClient.getSigningKey.mockImplementation(
        (_kid: string, cb: (err: Error | null, key?: unknown) => void) => {
          cb(jwksError);
        },
      );

      vi.mocked(jwt.verify).mockImplementation(
        (_t: string, getKey: any, _opts: any, callback: any) => {
          // Simulate jsonwebtoken calling getKey, then callback with the error
          getKey({ kid: 'kid-1' }, (err: Error | null) => {
            callback(err);
          });
          return undefined as any;
        },
      );

      const client = makeSocket();
      await gateway.handleConnection(client as never);

      // verifyToken rejects → catch block → disconnect
      expect(client.disconnect).toHaveBeenCalled();
    });

    it('resolves and completes connection when getSigningKey and jwt.verify both succeed', async () => {
      const mockKey = { getPublicKey: () => 'mock-public-key' };
      (gateway as any).jwksClient.getSigningKey.mockImplementation(
        (_kid: string, cb: (err: null, key: typeof mockKey) => void) => {
          cb(null, mockKey);
        },
      );

      vi.mocked(jwt.verify).mockImplementation(
        (_t: string, getKey: any, _opts: any, callback: any) => {
          getKey({ kid: 'kid-1' }, (_err: null, _pubKey: string) => {
            callback(null, { sub: 'auth0|user-1' });
          });
          return undefined as any;
        },
      );

      mockRepo.findUserByAuth0Id.mockResolvedValue({
        id: 'user-uuid-1',
        email: 'user@test.com',
      });
      mockRepo.findActiveOrgMemberships.mockResolvedValue([]);
      mockNotificationsService.getUnreadCount.mockResolvedValue(0);

      const client = makeSocket();
      await gateway.handleConnection(client as never);

      expect(client.disconnect).not.toHaveBeenCalled();
      expect(client.emit).toHaveBeenCalledWith(
        'notification:unread-count',
        expect.any(Object),
      );
    });

    it('resolves when getSigningKey key is undefined (covers key?.getPublicKey() — line 364)', async () => {
      (gateway as any).jwksClient.getSigningKey.mockImplementation(
        (_kid: string, cb: (err: null, key?: undefined) => void) => {
          cb(null, undefined);
        },
      );

      vi.mocked(jwt.verify).mockImplementation(
        (_t: string, getKey: any, _opts: any, callback: any) => {
          getKey({ kid: 'kid-1' }, (err: Error | null, _pubKey: unknown) => {
            if (err) callback(err);
            else callback(null, { sub: 'auth0|user-1' });
          });
          return undefined as any;
        },
      );

      mockRepo.findUserByAuth0Id.mockResolvedValue({
        id: 'user-uuid-1',
        email: 'user@test.com',
      });
      mockRepo.findActiveOrgMemberships.mockResolvedValue([]);
      mockNotificationsService.getUnreadCount.mockResolvedValue(0);

      const client = makeSocket();
      await gateway.handleConnection(client as never);

      expect(client.emit).toHaveBeenCalledWith(
        'notification:unread-count',
        expect.any(Object),
      );
    });

    it('rejects when jwt.verify callback receives an error', async () => {
      const mockKey = { getPublicKey: () => 'mock-public-key' };
      (gateway as any).jwksClient.getSigningKey.mockImplementation(
        (_kid: string, cb: (err: null, key: typeof mockKey) => void) => {
          cb(null, mockKey);
        },
      );

      vi.mocked(jwt.verify).mockImplementation(
        (_t: string, getKey: any, _opts: any, callback: any) => {
          getKey({ kid: 'kid-1' }, (_err: null, _pubKey: string) => {
            callback(new Error('token expired'));
          });
          return undefined as any;
        },
      );

      const client = makeSocket();
      await gateway.handleConnection(client as never);

      expect(client.disconnect).toHaveBeenCalled();
    });
  });
});
