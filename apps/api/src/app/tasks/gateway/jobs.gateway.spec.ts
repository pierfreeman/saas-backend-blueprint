/**
 * Unit tests for JobsGateway.
 *
 * We test the gateway in isolation — without a real socket.io Server or Redis
 * connection — by providing lightweight mocks for PubSubService, the
 * socket.io Server, and individual socket instances.
 */
import { JobsGateway } from './jobs.gateway';
import { PubSubService } from '@libs/redis';
import { JobStatus } from '@libs/prisma-business';
import { Mock, Mocked, vi } from 'vitest';

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Creates a minimal JWT with the given `sub` claim.
 * Signature segment is omitted — the gateway only decodes the payload.
 */
function makeToken(sub: string, extra: Record<string, unknown> = {}): string {
  const header = Buffer.from('{"alg":"RS256"}').toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({ sub, email: `${sub}@test.com`, ...extra }),
  ).toString('base64url');
  return `${header}.${payload}.fake-signature`;
}

/** Minimal socket.io socket stub. */
function makeSocket(overrides: Record<string, unknown> = {}) {
  const rooms = new Set<string>();
  return {
    id: 'socket-1',
    handshake: {
      auth: {},
      query: {},
      headers: {},
    },
    join: vi.fn(async (room: string) => {
      rooms.add(room);
    }),
    disconnect: vi.fn(),
    userId: undefined as string | undefined,
    tenantId: undefined as string | undefined,
    _rooms: rooms,
    ...overrides,
  };
}

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockServer = {
  to: vi.fn().mockReturnThis(),
  emit: vi.fn(),
};

const mockPubSub: Mocked<Pick<PubSubService, 'pSubscribe'>> = {
  pSubscribe: vi.fn(),
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('JobsGateway', () => {
  let gateway: JobsGateway;

  beforeEach(() => {
    vi.clearAllMocks();
    gateway = new JobsGateway(mockPubSub as unknown as PubSubService);
    // Inject the mock server (normally set by NestJS via @WebSocketServer).
    (gateway as any).server = mockServer;
  });

  // ── afterInit ─────────────────────────────────────────────────────────────

  describe('afterInit', () => {
    it('subscribes to the "job:update:*" Redis pattern on initialisation', () => {
      gateway.afterInit();
      expect(mockPubSub.pSubscribe).toHaveBeenCalledWith(
        'job:update:*',
        expect.any(Function),
      );
    });

    it('emits "job:update" to the tenant room when a Redis message arrives', () => {
      gateway.afterInit();

      const handler: (ch: string, payload: unknown) => void =
        mockPubSub.pSubscribe.mock.calls[0][1];

      const msg = {
        jobId: 'job-1',
        status: JobStatus.DONE,
        tenantId: 'org-1',
        updatedAt: new Date().toISOString(),
      };

      handler('job:update:org-1', msg);

      expect(mockServer.to).toHaveBeenCalledWith('tenant:org-1');
      expect(mockServer.emit).toHaveBeenCalledWith('job:update', msg);
    });

    it('also emits "job:update" to the user room when userId is present', () => {
      gateway.afterInit();

      const handler: (ch: string, payload: unknown) => void =
        mockPubSub.pSubscribe.mock.calls[0][1];

      const msg = {
        jobId: 'job-2',
        status: JobStatus.FAILED,
        tenantId: 'org-1',
        userId: 'user-abc',
        error: 'boom',
        updatedAt: new Date().toISOString(),
      };

      handler('job:update:org-1', msg);

      const toCalls = mockServer.to.mock.calls.map(([r]: [string]) => r);
      expect(toCalls).toContain('tenant:org-1');
      expect(toCalls).toContain('user:user-abc');
    });

    it('does NOT emit to user room when userId is absent', () => {
      gateway.afterInit();

      const handler: (ch: string, payload: unknown) => void =
        mockPubSub.pSubscribe.mock.calls[0][1];

      handler('job:update:org-1', {
        jobId: 'j3',
        status: JobStatus.PROCESSING,
        tenantId: 'org-1',
        updatedAt: new Date().toISOString(),
      });

      const toCalls = mockServer.to.mock.calls.map(([r]: [string]) => r);
      expect(toCalls.some((r: string) => r.startsWith('user:'))).toBe(false);
    });
  });

  // ── handleConnection ───────────────────────────────────────────────────────

  describe('handleConnection', () => {
    it('joins user and tenant rooms on valid token + tenantId query', async () => {
      const socket = makeSocket({
        handshake: {
          auth: { token: makeToken('user-1') },
          query: { tenantId: 'org-1' },
          headers: {},
        },
      });

      await gateway.handleConnection(socket as any);

      expect(socket.userId).toBe('user-1');
      expect(socket.tenantId).toBe('org-1');
      expect(socket.join).toHaveBeenCalledWith('user:user-1');
      expect(socket.join).toHaveBeenCalledWith('tenant:org-1');
      expect(socket.disconnect).not.toHaveBeenCalled();
    });

    it('reads token from handshake.query when auth is absent', async () => {
      const token = makeToken('user-2');
      const socket = makeSocket({
        handshake: {
          auth: {},
          query: { token },
          headers: {},
        },
      });

      await gateway.handleConnection(socket as any);

      expect(socket.userId).toBe('user-2');
      expect(socket.disconnect).not.toHaveBeenCalled();
    });

    it('reads token from Authorization header as last fallback', async () => {
      const token = makeToken('user-3');
      const socket = makeSocket({
        handshake: {
          auth: {},
          query: {},
          headers: { authorization: `Bearer ${token}` },
        },
      });

      await gateway.handleConnection(socket as any);

      expect(socket.userId).toBe('user-3');
    });

    it('disconnects when no token is provided', async () => {
      const socket = makeSocket();

      await gateway.handleConnection(socket as any);

      expect(socket.disconnect).toHaveBeenCalledTimes(1);
      expect(socket.userId).toBeUndefined();
    });

    it('disconnects when the token has no sub claim', async () => {
      const headerB64 = Buffer.from('{"alg":"RS256"}').toString('base64url');
      const payloadB64 = Buffer.from('{"email":"no-sub@test.com"}').toString(
        'base64url',
      );
      const token = `${headerB64}.${payloadB64}.sig`;

      const socket = makeSocket({
        handshake: { auth: { token }, query: {}, headers: {} },
      });

      await gateway.handleConnection(socket as any);

      expect(socket.disconnect).toHaveBeenCalledTimes(1);
    });

    it('skips tenant room join when tenantId is not provided', async () => {
      const socket = makeSocket({
        handshake: {
          auth: { token: makeToken('user-4') },
          query: {},
          headers: {},
        },
      });

      await gateway.handleConnection(socket as any);

      expect(socket.join).toHaveBeenCalledWith('user:user-4');
      const joinCalls = (socket.join as Mock).mock.calls.map(
        ([r]: [string]) => r,
      );
      expect(joinCalls.some((r) => r.startsWith('tenant:'))).toBe(false);
    });
  });

  // ── handleDisconnect ───────────────────────────────────────────────────────

  describe('handleDisconnect', () => {
    it('does not throw even for unauthenticated sockets', () => {
      const socket = makeSocket();
      expect(() => gateway.handleDisconnect(socket as any)).not.toThrow();
    });

    it('logs the correct user id on disconnect', () => {
      const logSpy = vi
        .spyOn((gateway as any).logger, 'log')
        .mockImplementation(() => undefined);

      const socket = makeSocket({ userId: 'user-5' } as any);
      gateway.handleDisconnect(socket as any);

      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('user-5'));
    });
  });

  // ── handleConnection error path (lines 123-124) ──────────────────────────

  describe('handleConnection — unexpected error in catch block', () => {
    it('disconnects the socket when client.join throws unexpectedly', async () => {
      const token = makeToken('user-err');
      const socket = makeSocket({
        handshake: {
          auth: { token },
          query: {},
          headers: {},
        },
      });
      // Force client.join to throw to trigger the catch block (lines 123-124)
      (socket.join as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('join failed'),
      );

      await gateway.handleConnection(socket as any);

      expect(socket.disconnect).toHaveBeenCalledTimes(1);
    });
  });

  // ── decodeJwt — token with fewer than 2 segments (line 170) ─────────────

  describe('decodeJwt private method — short token branch', () => {
    it('returns null when the token has fewer than 2 segments', async () => {
      // A token without a "." has only 1 segment — triggers `if (segments.length < 2) return null`
      const socket = makeSocket({
        handshake: {
          auth: { token: 'nosegments' },
          query: {},
          headers: {},
        },
      });

      await gateway.handleConnection(socket as any);

      // No valid sub → must disconnect
      expect(socket.disconnect).toHaveBeenCalledTimes(1);
    });

    it('returns null when the JWT payload is invalid JSON', async () => {
      // Two segments but the second is not valid base64url JSON
      const header = Buffer.from('{"alg":"RS256"}').toString('base64url');
      const badPayload = '!!!not-valid-base64!!!';
      const token = `${header}.${badPayload}.sig`;

      const socket = makeSocket({
        handshake: { auth: { token }, query: {}, headers: {} },
      });

      await gateway.handleConnection(socket as any);

      expect(socket.disconnect).toHaveBeenCalledTimes(1);
    });
  });
});
