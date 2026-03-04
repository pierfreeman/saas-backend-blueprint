import { AuthService } from './auth.service';
import { PrismaBusinessService } from '@libs/prisma-business';

const mockPrisma = {
  user: {
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
} as unknown as PrismaBusinessService;

describe('AuthService', () => {
  let service: AuthService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AuthService(mockPrisma);
  });

  describe('syncUser', () => {
    it('creates a new user when none exists', async () => {
      const created = {
        id: 'u-1',
        auth0Id: 'auth0|1',
        email: 'a@b.com',
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      mockPrisma.user.findUnique = jest.fn().mockResolvedValue(null);
      mockPrisma.user.create = jest.fn().mockResolvedValue(created);

      const result = await service.syncUser('auth0|1', 'a@b.com');
      expect(result).toBe(created);
      expect(mockPrisma.user.create).toHaveBeenCalledWith({
        data: { auth0Id: 'auth0|1', email: 'a@b.com' },
      });
    });

    it('returns existing user when email is unchanged', async () => {
      const existing = {
        id: 'u-1',
        auth0Id: 'auth0|1',
        email: 'a@b.com',
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      mockPrisma.user.findUnique = jest.fn().mockResolvedValue(existing);
      mockPrisma.user.create = jest.fn();
      mockPrisma.user.update = jest.fn();

      const result = await service.syncUser('auth0|1', 'a@b.com');
      expect(result).toBe(existing);
      expect(mockPrisma.user.create).not.toHaveBeenCalled();
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });

    it('updates email when it has changed', async () => {
      const existing = {
        id: 'u-1',
        auth0Id: 'auth0|1',
        email: 'old@b.com',
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      const updated = { ...existing, email: 'new@b.com' };
      mockPrisma.user.findUnique = jest.fn().mockResolvedValue(existing);
      mockPrisma.user.update = jest.fn().mockResolvedValue(updated);

      const result = await service.syncUser('auth0|1', 'new@b.com');
      expect(result).toBe(updated);
      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'u-1' },
        data: { email: 'new@b.com' },
      });
    });
  });

  describe('findUserByAuth0Id', () => {
    it('returns user when found', async () => {
      const user = {
        id: 'u-1',
        auth0Id: 'auth0|1',
        email: 'a@b.com',
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      mockPrisma.user.findUnique = jest.fn().mockResolvedValue(user);
      expect(await service.findUserByAuth0Id('auth0|1')).toBe(user);
    });

    it('returns null when not found', async () => {
      mockPrisma.user.findUnique = jest.fn().mockResolvedValue(null);
      expect(await service.findUserByAuth0Id('auth0|x')).toBeNull();
    });
  });

  describe('findUserById', () => {
    it('returns user by id', async () => {
      const user = {
        id: 'u-1',
        auth0Id: 'auth0|1',
        email: 'a@b.com',
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      mockPrisma.user.findUnique = jest.fn().mockResolvedValue(user);
      expect(await service.findUserById('u-1')).toBe(user);
    });

    it('returns null when user is not found', async () => {
      mockPrisma.user.findUnique = jest.fn().mockResolvedValue(null);
      expect(await service.findUserById('nonexistent')).toBeNull();
    });
  });

  describe('syncUser — edge cases', () => {
    it('propagates DB errors thrown by user.create', async () => {
      mockPrisma.user.findUnique = jest.fn().mockResolvedValue(null);
      mockPrisma.user.create = jest
        .fn()
        .mockRejectedValue(new Error('Unique constraint failed'));

      await expect(service.syncUser('auth0|new', 'new@b.com')).rejects.toThrow(
        'Unique constraint failed',
      );
    });

    it('propagates DB errors thrown by user.findUnique', async () => {
      mockPrisma.user.findUnique = jest
        .fn()
        .mockRejectedValue(new Error('Connection refused'));

      await expect(service.syncUser('auth0|1', 'a@b.com')).rejects.toThrow(
        'Connection refused',
      );
    });

    it('propagates DB errors thrown by user.update', async () => {
      const existing = {
        id: 'u-1',
        auth0Id: 'auth0|1',
        email: 'old@b.com',
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      mockPrisma.user.findUnique = jest.fn().mockResolvedValue(existing);
      mockPrisma.user.update = jest
        .fn()
        .mockRejectedValue(new Error('Update failed'));

      await expect(service.syncUser('auth0|1', 'new@b.com')).rejects.toThrow(
        'Update failed',
      );
    });
  });
});
