import { Test, TestingModule } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminUserRepository } from './admin-user.repository';
import { PrismaLegalService } from '@libs/prisma-legal';

describe('AdminUserRepository', () => {
  let repository: AdminUserRepository;

  const mockPrisma = {
    adminUser: {
      upsert: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
    },
  };

  beforeEach(async () => {
    vi.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminUserRepository,
        { provide: PrismaLegalService, useValue: mockPrisma },
      ],
    }).compile();

    repository = module.get(AdminUserRepository);
  });

  describe('upsertByAuth0Id', () => {
    it('calls prisma.adminUser.upsert with correct args', async () => {
      const mockUser = {
        id: 'uuid-1',
        auth0Id: 'auth0|abc',
        email: 'admin@example.com',
        displayName: 'Admin',
      };
      mockPrisma.adminUser.upsert.mockResolvedValue(mockUser);

      const result = await repository.upsertByAuth0Id(
        'auth0|abc',
        'admin@example.com',
        'Admin',
      );

      expect(mockPrisma.adminUser.upsert).toHaveBeenCalledWith({
        where: { auth0Id: 'auth0|abc' },
        create: {
          auth0Id: 'auth0|abc',
          email: 'admin@example.com',
          displayName: 'Admin',
        },
        update: { email: 'admin@example.com', displayName: 'Admin' },
      });
      expect(result).toBe(mockUser);
    });
  });

  describe('findByAuth0Id', () => {
    it('returns null when user not found', async () => {
      mockPrisma.adminUser.findUnique.mockResolvedValue(null);
      const result = await repository.findByAuth0Id('auth0|unknown');
      expect(result).toBeNull();
    });
  });

  describe('findById', () => {
    it('looks up by internal UUID', async () => {
      const mockUser = { id: 'uuid-1', auth0Id: 'auth0|abc' };
      mockPrisma.adminUser.findUnique.mockResolvedValue(mockUser);

      const result = await repository.findById('uuid-1');
      expect(mockPrisma.adminUser.findUnique).toHaveBeenCalledWith({
        where: { id: 'uuid-1' },
      });
      expect(result).toBe(mockUser);
    });
  });

  describe('findAll', () => {
    it('returns ordered list', async () => {
      const mockUsers = [{ id: 'uuid-1' }, { id: 'uuid-2' }];
      mockPrisma.adminUser.findMany.mockResolvedValue(mockUsers);

      const result = await repository.findAll();
      expect(mockPrisma.adminUser.findMany).toHaveBeenCalledWith({
        orderBy: { createdAt: 'asc' },
      });
      expect(result).toHaveLength(2);
    });
  });
});
