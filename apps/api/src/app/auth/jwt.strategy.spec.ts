import { UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';

// Stub PassportStrategy and passport-jwt to avoid real JWKS setup
jest.mock('@nestjs/passport', () => ({
  PassportStrategy: () => class {},
}));
jest.mock('passport-jwt', () => ({
  Strategy: class {},
  ExtractJwt: { fromAuthHeaderAsBearerToken: jest.fn(() => jest.fn()) },
}));
jest.mock('jwks-rsa', () => ({ passportJwtSecret: jest.fn(() => jest.fn()) }));

// Import AFTER mocks
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { JwtStrategy } = require('./jwt.strategy') as {
  JwtStrategy: new (config: any, auth: any) => { validate: (p: any) => any };
};

const mockConfigService = {
  get: jest.fn((key: string) => {
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
  syncUser: jest.fn(),
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

  beforeEach(() => {
    jest.clearAllMocks();
    strategy = new JwtStrategy(mockConfigService, mockAuthService);
  });

  it('returns sub and email from DB user on success', async () => {
    mockAuthService.syncUser = jest.fn().mockResolvedValue(dbUser);

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
    mockAuthService.syncUser = jest.fn().mockResolvedValue(dbUser);

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
    mockAuthService.syncUser = jest
      .fn()
      .mockRejectedValue(new Error('DB error'));

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
