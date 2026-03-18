import { AuthService } from './auth.service';
import { UserRepository } from '@libs/users';

const mockUserRepository = {
  findByAuth0Id: jest.fn(),
  provisionWithPersonalOrg: jest.fn(),
  updateEmail: jest.fn(),
  findById: jest.fn(),
} as unknown as UserRepository;

describe('AuthService', () => {
  let service: AuthService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AuthService(mockUserRepository);
  });

  describe('syncUser', () => {
    it('provisions new user + personal org in one operation', async () => {
      const createdUser = {
        id: 'u-1',
        auth0Id: 'auth0|1',
        email: 'a@b.com',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockUserRepository.findByAuth0Id = jest.fn().mockResolvedValue(null);
      mockUserRepository.provisionWithPersonalOrg = jest
        .fn()
        .mockResolvedValue(createdUser);

      const result = await service.syncUser('auth0|1', 'a@b.com');

      expect(result).toBe(createdUser);
      expect(mockUserRepository.provisionWithPersonalOrg).toHaveBeenCalledWith(
        'auth0|1',
        'a@b.com',
      );
    });

    it('returns existing user when email is unchanged — no update', async () => {
      const existing = {
        id: 'u-1',
        auth0Id: 'auth0|1',
        email: 'a@b.com',
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      mockUserRepository.findByAuth0Id = jest.fn().mockResolvedValue(existing);
      mockUserRepository.updateEmail = jest.fn();

      const result = await service.syncUser('auth0|1', 'a@b.com');
      expect(result).toBe(existing);
      expect(mockUserRepository.updateEmail).not.toHaveBeenCalled();
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
      mockUserRepository.findByAuth0Id = jest.fn().mockResolvedValue(existing);
      mockUserRepository.updateEmail = jest.fn().mockResolvedValue(updated);

      const result = await service.syncUser('auth0|1', 'new@b.com');
      expect(result).toBe(updated);
      expect(mockUserRepository.updateEmail).toHaveBeenCalledWith(
        'u-1',
        'new@b.com',
      );
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
      mockUserRepository.findByAuth0Id = jest.fn().mockResolvedValue(user);
      expect(await service.findUserByAuth0Id('auth0|1')).toBe(user);
    });

    it('returns null when not found', async () => {
      mockUserRepository.findByAuth0Id = jest.fn().mockResolvedValue(null);
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
      mockUserRepository.findById = jest.fn().mockResolvedValue(user);
      expect(await service.findUserById('u-1')).toBe(user);
    });

    it('returns null when not found', async () => {
      mockUserRepository.findById = jest.fn().mockResolvedValue(null);
      expect(await service.findUserById('nonexistent')).toBeNull();
    });
  });

  describe('syncUser — edge cases', () => {
    it('propagates errors from provisionWithPersonalOrg', async () => {
      mockUserRepository.findByAuth0Id = jest.fn().mockResolvedValue(null);
      mockUserRepository.provisionWithPersonalOrg = jest
        .fn()
        .mockRejectedValue(new Error('Transaction aborted'));

      await expect(service.syncUser('auth0|new', 'new@b.com')).rejects.toThrow(
        'Transaction aborted',
      );
    });

    it('propagates DB errors from findByAuth0Id', async () => {
      mockUserRepository.findByAuth0Id = jest
        .fn()
        .mockRejectedValue(new Error('Connection refused'));

      await expect(service.syncUser('auth0|1', 'a@b.com')).rejects.toThrow(
        'Connection refused',
      );
    });

    it('propagates DB errors from updateEmail', async () => {
      const existing = {
        id: 'u-1',
        auth0Id: 'auth0|1',
        email: 'old@b.com',
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      mockUserRepository.findByAuth0Id = jest.fn().mockResolvedValue(existing);
      mockUserRepository.updateEmail = jest
        .fn()
        .mockRejectedValue(new Error('Update failed'));

      await expect(service.syncUser('auth0|1', 'new@b.com')).rejects.toThrow(
        'Update failed',
      );
    });
  });
});
