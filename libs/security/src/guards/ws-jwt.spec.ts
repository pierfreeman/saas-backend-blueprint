import { WsJwtGuard } from './ws-jwt.guard';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { WsException } from '@nestjs/websockets';
import { ExecutionContext } from '@nestjs/common';
import { Socket } from 'socket.io';
import { vi } from 'vitest';

// ─── JWT mock helpers ────────────────────────────────────────────────────────

const VALID_PAYLOAD = {
  sub: 'auth0|123456',
  email: 'test@example.com',
  iss: 'https://test.auth0.com/',
  aud: 'https://api.example.com',
};

// Capture the mock instance the guard creates so tests can override it per-call
const { lastJwksInstanceRef, mockVerify } = vi.hoisted(() => ({
  lastJwksInstanceRef: {
    current: null as { getSigningKey: ReturnType<typeof vi.fn> } | null,
  },
  mockVerify: vi.fn(),
}));

vi.mock('jwks-rsa', () => ({
  JwksClient: vi.fn(function (this: unknown) {
    const inst = {
      getSigningKey: vi.fn(
        (_kid: string, cb: (err: Error | null, key: unknown) => void) => {
          cb(null, { getPublicKey: () => 'mock-public-key' });
        },
      ),
    };
    lastJwksInstanceRef.current = inst;
    return inst;
  }),
}));

vi.mock('jsonwebtoken', () => ({
  decode: vi.fn(() => ({
    header: { kid: 'test-key-id', alg: 'RS256' },
    payload: VALID_PAYLOAD,
  })),
  verify: mockVerify,
}));

// Initialize mockVerify default implementation
mockVerify.mockImplementation(
  (
    _token: string,
    _key: string,
    _opts: unknown,
    cb: (err: Error | null, payload: unknown) => void,
  ) => {
    cb(null, VALID_PAYLOAD);
  },
);

// ─── helpers ─────────────────────────────────────────────────────────────────

function makeSocketContext(
  token?: string,
  headerToken?: string,
): ExecutionContext {
  const socket = {
    handshake: {
      auth: token ? { token } : {},
      headers: headerToken ? { authorization: `Bearer ${headerToken}` } : {},
    },
    data: {} as Record<string, unknown>,
  } as unknown as Socket;

  return {
    getType: () => 'ws',
    switchToWs: () => ({
      getClient: () => socket,
    }),
  } as unknown as ExecutionContext;
}

describe('WsJwtGuard', () => {
  let guard: WsJwtGuard;

  beforeEach(async () => {
    vi.clearAllMocks();
    lastJwksInstanceRef.current = null;
    // Re-apply default verify implementation after clearAllMocks
    mockVerify.mockImplementation(
      (
        _token: string,
        _key: string,
        _opts: unknown,
        cb: (err: Error | null, payload: unknown) => void,
      ) => {
        cb(null, VALID_PAYLOAD);
      },
    );
    const module = await Test.createTestingModule({
      providers: [
        WsJwtGuard,
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) => {
              const config: Record<string, string> = {
                'auth.jwksUri': 'https://test.auth0.com/.well-known/jwks.json',
                'auth.audience': 'https://api.example.com',
                'auth.issuer': 'https://test.auth0.com/',
              };
              return config[key];
            },
          },
        },
      ],
    }).compile();

    guard = module.get(WsJwtGuard);
  });

  describe('Successful handshake', () => {
    it('allows connection when token is in auth object', async () => {
      const ctx = makeSocketContext('valid.jwt.token');
      const result = await guard.canActivate(ctx);
      expect(result).toBe(true);
    });

    it('allows connection when token is in Authorization header', async () => {
      const ctx = makeSocketContext(undefined, 'valid.jwt.token');
      const result = await guard.canActivate(ctx);
      expect(result).toBe(true);
    });

    it('attaches the decoded payload to socket.data.user', async () => {
      const socket = {
        handshake: { auth: { token: 'valid.jwt.token' }, headers: {} },
        data: {} as Record<string, unknown>,
      } as unknown as Socket;
      const ctx = {
        getType: () => 'ws',
        switchToWs: () => ({ getClient: () => socket }),
      } as unknown as ExecutionContext;

      await guard.canActivate(ctx);
      expect(socket.data['user']).toEqual(VALID_PAYLOAD);
    });
  });

  describe('Rejected handshake', () => {
    it('throws WsException when no token is provided', async () => {
      const ctx = makeSocketContext(); // no token
      await expect(guard.canActivate(ctx)).rejects.toThrow(WsException);
    });

    it('throws WsException when JWT verification fails', async () => {
      mockVerify.mockImplementationOnce(
        (
          _t: unknown,
          _k: unknown,
          _o: unknown,
          cb: (err: Error | null) => void,
        ) => {
          cb(new Error('TokenExpiredError'));
        },
      );

      const ctx = makeSocketContext('expired.token');
      await expect(guard.canActivate(ctx)).rejects.toThrow(WsException);
    });

    it('throws WsException when JWKS fetch fails', async () => {
      // lastJwksInstanceRef.current is the JwksClient instance the guard created in beforeEach
      expect(lastJwksInstanceRef.current).not.toBeNull();
      lastJwksInstanceRef.current!.getSigningKey.mockImplementationOnce(
        (_kid: string, cb: (err: Error | null) => void) => {
          cb(new Error('JWKS fetch failed'));
        },
      );

      const ctx = makeSocketContext('some.valid.token');
      await expect(guard.canActivate(ctx)).rejects.toThrow(WsException);
    });
  });
});
