import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminJwtStrategy } from './admin-jwt.strategy';
import { AdminIdentityService } from '../../application/services/admin-identity.service';

describe('AdminJwtStrategy', () => {
  let strategy: AdminJwtStrategy;

  const mockConfigService = {
    get: vi.fn().mockReturnValue({
      domain: 'test.auth0.com',
      audience: 'https://admin-api.saas.com',
      issuer: 'https://test.auth0.com/',
      jwksUri: 'https://test.auth0.com/.well-known/jwks.json',
      claimsNamespace: 'https://admin.saas-api.com/',
    }),
  };

  const mockAdminIdentityService = {
    syncAdminUser: vi.fn(),
  };

  beforeEach(async () => {
    vi.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminJwtStrategy,
        { provide: ConfigService, useValue: mockConfigService },
        {
          provide: AdminIdentityService,
          useValue: mockAdminIdentityService,
        },
      ],
    }).compile();

    strategy = module.get(AdminJwtStrategy);
  });

  describe('validate', () => {
    it('syncs admin user and returns user object', async () => {
      mockAdminIdentityService.syncAdminUser.mockResolvedValue({
        adminUserId: 'uuid-admin-1',
        auth0Id: 'auth0|abc',
        email: 'admin@example.com',
        displayName: 'Admin',
      });

      const result = await strategy.validate({
        sub: 'auth0|abc',
        email: 'admin@example.com',
        name: 'Admin',
      });

      expect(mockAdminIdentityService.syncAdminUser).toHaveBeenCalledWith(
        'auth0|abc',
        'admin@example.com',
        'Admin',
      );
      expect(result).toEqual({
        sub: 'auth0|abc',
        email: 'admin@example.com',
        adminUserId: 'uuid-admin-1',
      });
    });
  });
});
