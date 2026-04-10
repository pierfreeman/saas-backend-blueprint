import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminJwtStrategy } from './admin-jwt.strategy';
import { AdminIdentityService } from '../../application/services/admin-identity.service';

const NS = 'https://admin.saas-api.com/';

const baseAdminAuth = {
  domain: 'test.auth0.com',
  audience: 'https://admin-api.saas.com',
  issuer: 'https://test.auth0.com/',
  jwksUri: 'https://test.auth0.com/.well-known/jwks.json',
};

const mockAdminIdentityService = {
  syncAdminUser: vi.fn(),
};

async function buildStrategy(adminAuth: object): Promise<AdminJwtStrategy> {
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      AdminJwtStrategy,
      {
        provide: ConfigService,
        useValue: { get: vi.fn().mockReturnValue(adminAuth) },
      },
      { provide: AdminIdentityService, useValue: mockAdminIdentityService },
    ],
  }).compile();
  return module.get(AdminJwtStrategy);
}

describe('AdminJwtStrategy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAdminIdentityService.syncAdminUser.mockResolvedValue({
      adminUserId: 'uuid-admin-1',
      auth0Id: 'auth0|abc',
      email: 'admin@example.com',
      displayName: 'Admin',
    });
  });

  describe('constructor', () => {
    it('throws when domain is missing', async () => {
      await expect(
        buildStrategy({ ...baseAdminAuth, domain: undefined }),
      ).rejects.toThrow(
        'ADMIN_AUTH0_DOMAIN and ADMIN_AUTH0_AUDIENCE are required',
      );
    });

    it('throws when audience is missing', async () => {
      await expect(
        buildStrategy({ ...baseAdminAuth, audience: undefined }),
      ).rejects.toThrow(
        'ADMIN_AUTH0_DOMAIN and ADMIN_AUTH0_AUDIENCE are required',
      );
    });
  });

  describe('validate — with claimsNamespace', () => {
    let strategy: AdminJwtStrategy;

    beforeEach(async () => {
      strategy = await buildStrategy({ ...baseAdminAuth, claimsNamespace: NS });
    });

    it('prefers namespaced email over plain email', async () => {
      const result = await strategy.validate({
        sub: 'auth0|abc',
        [`${NS}email`]: 'namespaced@example.com',
        email: 'plain@example.com',
        [`${NS}name`]: 'Namespaced Name',
      });

      expect(mockAdminIdentityService.syncAdminUser).toHaveBeenCalledWith(
        'auth0|abc',
        'namespaced@example.com',
        'Namespaced Name',
      );
      expect(result.email).toBe('namespaced@example.com');
    });

    it('falls back to plain email when no namespaced email', async () => {
      await strategy.validate({
        sub: 'auth0|abc',
        email: 'plain@example.com',
        name: 'Plain Name',
      });

      expect(mockAdminIdentityService.syncAdminUser).toHaveBeenCalledWith(
        'auth0|abc',
        'plain@example.com',
        'Plain Name',
      );
    });

    it('falls back to synthetic email when no email claim at all', async () => {
      await strategy.validate({ sub: 'auth0|abc' });

      expect(mockAdminIdentityService.syncAdminUser).toHaveBeenCalledWith(
        'auth0|abc',
        'auth0|abc@admin.placeholder',
        undefined,
      );
    });

    it('returns { sub, email, adminUserId }', async () => {
      const result = await strategy.validate({
        sub: 'auth0|abc',
        email: 'admin@example.com',
      });

      expect(result).toEqual({
        sub: 'auth0|abc',
        email: 'admin@example.com',
        adminUserId: 'uuid-admin-1',
      });
    });
  });

  describe('validate — without claimsNamespace', () => {
    let strategy: AdminJwtStrategy;

    beforeEach(async () => {
      strategy = await buildStrategy({ ...baseAdminAuth, claimsNamespace: '' });
    });

    it('uses plain email directly when namespace is empty', async () => {
      await strategy.validate({
        sub: 'auth0|abc',
        email: 'plain@example.com',
        name: 'Plain Name',
      });

      expect(mockAdminIdentityService.syncAdminUser).toHaveBeenCalledWith(
        'auth0|abc',
        'plain@example.com',
        'Plain Name',
      );
    });
  });
});
