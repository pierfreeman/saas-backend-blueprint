import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminIdentityService } from './admin-identity.service';
import { AdminUserRepository } from '../../infrastructure/repositories/admin-user.repository';

describe('AdminIdentityService', () => {
  let service: AdminIdentityService;

  const mockRepository = {
    upsertByAuth0Id: vi.fn(),
    findById: vi.fn(),
    findAll: vi.fn(),
  };

  const mockAdminUser = {
    id: 'uuid-admin-1',
    auth0Id: 'auth0|abc123',
    email: 'admin@example.com',
    displayName: 'Super Admin',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    vi.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminIdentityService,
        { provide: AdminUserRepository, useValue: mockRepository },
      ],
    }).compile();

    service = module.get(AdminIdentityService);
  });

  describe('syncAdminUser', () => {
    it('upserts the admin user and returns a profile', async () => {
      mockRepository.upsertByAuth0Id.mockResolvedValue(mockAdminUser);

      const result = await service.syncAdminUser(
        'auth0|abc123',
        'admin@example.com',
        'Super Admin',
      );

      expect(mockRepository.upsertByAuth0Id).toHaveBeenCalledWith(
        'auth0|abc123',
        'admin@example.com',
        'Super Admin',
      );
      expect(result).toEqual({
        adminUserId: 'uuid-admin-1',
        auth0Id: 'auth0|abc123',
        email: 'admin@example.com',
        displayName: 'Super Admin',
      });
    });
  });

  describe('findByIdOrThrow', () => {
    it('returns profile when admin user exists', async () => {
      mockRepository.findById.mockResolvedValue(mockAdminUser);

      const result = await service.findByIdOrThrow('uuid-admin-1');

      expect(result.adminUserId).toBe('uuid-admin-1');
    });

    it('throws UnauthorizedException when admin user not found', async () => {
      mockRepository.findById.mockResolvedValue(null);

      await expect(service.findByIdOrThrow('non-existent')).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('findAll', () => {
    it('maps all users to profiles', async () => {
      mockRepository.findAll.mockResolvedValue([mockAdminUser]);

      const result = await service.findAll();

      expect(result).toHaveLength(1);
      expect(result[0].adminUserId).toBe('uuid-admin-1');
    });
  });
});
