import { UnauthorizedException } from '@nestjs/common';
import { AuthService } from './application/services/auth.service';
import { vi } from 'vitest';

vi.mock('@nestjs/passport', async (importOriginal) => {
  const original = await importOriginal<typeof import('@nestjs/passport')>();
  return {
    ...original,
    PassportStrategy: () => class {},
  };
});
vi.mock('passport-jwt', () => ({
  Strategy: class {},
  ExtractJwt: { fromAuthHeaderAsBearerToken: vi.fn(() => vi.fn()) },
}));
vi.mock('jwks-rsa', () => ({ passportJwtSecret: vi.fn(() => vi.fn()) }));

// JwtStrategy is loaded after mocks via dynamic import in beforeAll
let JwtStrategy: new (config: any, auth: any) => { validate: (p: any) => any };

const mockConfigService = {
  get: vi.fn((key: string) => {
    const map: Record<string, string> = {
      'auth.domain': 'example.auth0.com',
      'auth.audience': 'https://api.example.com',
      'auth.issuer': 'https://example.auth0.com/',
      'auth.jwksUri': 'https://example.auth0.com/.well-known/jwks.json',
    };
    return map[key];
  }),
};

const mockAuthService = {
  syncUser: vi.fn(),
} as unknown as AuthService;

const dbUser = {
  id: 'db-1',
  auth0Id: 'auth0|u1',
  email: 'confirmed@example.com',
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('JwtStrategy.validate', () => {
  let strategy: { validate: (p: any) => Promise<any> };

  beforeAll(async () => {
    const mod = await import('./jwt.strategy');
    JwtStrategy = mod.JwtStrategy;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    strategy = new JwtStrategy(mockConfigService, mockAuthService);
  });

  it('returns sub and email from DB user on success', async () => {
    mockAuthService.syncUser = vi.fn().mockResolvedValue(dbUser);

    const result = await strategy.validate({
      sub: 'auth0|u1',
      email: 'raw@example.com',
      iss: 'https://example.auth0.com/',
      aud: 'https://api.example.com',
    });

    expect(result).toEqual({ sub: 'auth0|u1', email: 'confirmed@example.com' });
    expect(mockAuthService.syncUser).toHaveBeenCalledWith(
      'auth0|u1',
      'raw@example.com',
    );
  });

  it('uses placeholder email when payload.email is missing', async () => {
    mockAuthService.syncUser = vi.fn().mockResolvedValue(dbUser);

    await strategy.validate({
      sub: 'auth0|u1',
      iss: 'https://example.auth0.com/',
      aud: 'https://api.example.com',
    });

    expect(mockAuthService.syncUser).toHaveBeenCalledWith(
      'auth0|u1',
      'auth0|u1@auth0.placeholder',
    );
  });

  it('throws UnauthorizedException when sub is missing', async () => {
    await expect(
      strategy.validate({
        sub: null,
        email: 'a@b.com',
        iss: 'https://example.auth0.com/',
        aud: 'https://api.example.com',
      }),
    ).rejects.toThrow(UnauthorizedException);
    expect(mockAuthService.syncUser).not.toHaveBeenCalled();
  });

  it('throws UnauthorizedException when syncUser throws', async () => {
    mockAuthService.syncUser = vi.fn().mockRejectedValue(new Error('DB error'));

    await expect(
      strategy.validate({
        sub: 'auth0|u1',
        email: 'a@b.com',
        iss: 'https://example.auth0.com/',
        aud: 'https://api.example.com',
      }),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('throws when Auth0 configuration is incomplete (missing config values)', () => {
    const incompleteConfig = { get: vi.fn().mockReturnValue(undefined) };
    expect(
      () => new JwtStrategy(incompleteConfig as any, mockAuthService),
    ).toThrow('Auth0 configuration is incomplete');
  });

  it('reads namespaced email claim when claimsNamespace is configured', async () => {
    const namespace = 'https://myapp.example.com';
    const nsConfigService = {
      get: vi.fn((key: string) => {
        const map: Record<string, string> = {
          'auth.domain': 'example.auth0.com',
          'auth.audience': 'https://api.example.com',
          'auth.issuer': 'https://example.auth0.com/',
          'auth.jwksUri': 'https://example.auth0.com/.well-known/jwks.json',
          'auth.claimsNamespace': namespace,
        };
        return map[key];
      }),
    };
    const nsStrategy = new JwtStrategy(nsConfigService as any, mockAuthService);
    mockAuthService.syncUser = vi.fn().mockResolvedValue(dbUser);

    await nsStrategy.validate({
      sub: 'auth0|u1',
      [`${namespace}/email`]: 'namespaced@example.com',
      iss: 'https://example.auth0.com/',
      aud: 'https://api.example.com',
    });

    expect(mockAuthService.syncUser).toHaveBeenCalledWith(
      'auth0|u1',
      'namespaced@example.com',
    );
  });

  it('throws UnauthorizedException when syncUser throws a non-Error value', async () => {
    // Covers the `'Unknown error'` branch of `error instanceof Error ? error.stack : 'Unknown error'`
    mockAuthService.syncUser = vi.fn().mockRejectedValue('plain string error');

    await expect(
      strategy.validate({
        sub: 'auth0|u1',
        email: 'a@b.com',
        iss: 'https://example.auth0.com/',
        aud: 'https://api.example.com',
      }),
    ).rejects.toThrow(UnauthorizedException);
  });
});
