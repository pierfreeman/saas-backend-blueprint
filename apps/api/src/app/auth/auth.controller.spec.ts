import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { RequestUser } from '@libs/common';
import { vi } from 'vitest';

const mockAuthService = {
  syncUser: vi.fn(),
  updateProfile: vi.fn(),
} as unknown as AuthService;

const baseUser: RequestUser = {
  sub: 'auth0|u1',
  email: 'user@example.com',
};

const dbUser = {
  id: 'db-u-1',
  auth0Id: 'auth0|u1',
  email: 'user@example.com',
  firstName: null,
  lastName: null,
  pictureUrl: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('AuthController', () => {
  let controller: AuthController;

  beforeEach(() => {
    vi.clearAllMocks();
    controller = new AuthController(mockAuthService);
  });

  describe('getMe', () => {
    it('returns id, auth0Id, email and profile fields', async () => {
      mockAuthService.syncUser = vi.fn().mockResolvedValue(dbUser);

      const result = await controller.getMe(baseUser);

      expect(result).toEqual({
        id: 'db-u-1',
        auth0Id: 'auth0|u1',
        email: 'user@example.com',
        firstName: null,
        lastName: null,
        pictureUrl: null,
      });
      expect(mockAuthService.syncUser).toHaveBeenCalledWith(
        'auth0|u1',
        'user@example.com',
      );
    });

    it('returns profile fields when populated', async () => {
      const dbUserWithProfile = {
        ...dbUser,
        firstName: 'Alice',
        lastName: 'Smith',
        pictureUrl: 'https://example.com/avatar.jpg',
      };
      mockAuthService.syncUser = vi.fn().mockResolvedValue(dbUserWithProfile);

      const result = await controller.getMe(baseUser);

      expect(result.firstName).toBe('Alice');
      expect(result.lastName).toBe('Smith');
      expect(result.pictureUrl).toBe('https://example.com/avatar.jpg');
    });

    it('returns the db email (not the JWT email) in the response', async () => {
      const dbUserWithDifferentEmail = {
        ...dbUser,
        email: 'updated@example.com',
      };
      mockAuthService.syncUser = vi
        .fn()
        .mockResolvedValue(dbUserWithDifferentEmail);

      const result = await controller.getMe(baseUser);
      expect(result.email).toBe('updated@example.com');
      expect(result.id).toBe('db-u-1');
    });

    it('propagates errors thrown by syncUser', async () => {
      mockAuthService.syncUser = vi
        .fn()
        .mockRejectedValue(new Error('DB down'));

      await expect(controller.getMe(baseUser)).rejects.toThrow('DB down');
    });
  });

  describe('updateMe', () => {
    it('syncs the user then updates profile fields', async () => {
      const updated = {
        ...dbUser,
        firstName: 'Bob',
        lastName: 'Jones',
        pictureUrl: 'https://example.com/bob.jpg',
      };
      mockAuthService.syncUser = vi.fn().mockResolvedValue(dbUser);
      mockAuthService.updateProfile = vi.fn().mockResolvedValue(updated);

      const result = await controller.updateMe(baseUser, {
        firstName: 'Bob',
        lastName: 'Jones',
        pictureUrl: 'https://example.com/bob.jpg',
      });

      expect(mockAuthService.syncUser).toHaveBeenCalledWith(
        'auth0|u1',
        'user@example.com',
      );
      expect(mockAuthService.updateProfile).toHaveBeenCalledWith('db-u-1', {
        firstName: 'Bob',
        lastName: 'Jones',
        pictureUrl: 'https://example.com/bob.jpg',
      });
      expect(result).toEqual({
        id: 'db-u-1',
        email: 'user@example.com',
        firstName: 'Bob',
        lastName: 'Jones',
        pictureUrl: 'https://example.com/bob.jpg',
      });
    });

    it('accepts partial updates', async () => {
      const updated = { ...dbUser, firstName: 'Carol' };
      mockAuthService.syncUser = vi.fn().mockResolvedValue(dbUser);
      mockAuthService.updateProfile = vi.fn().mockResolvedValue(updated);

      const result = await controller.updateMe(baseUser, {
        firstName: 'Carol',
      });

      expect(mockAuthService.updateProfile).toHaveBeenCalledWith('db-u-1', {
        firstName: 'Carol',
        lastName: undefined,
        pictureUrl: undefined,
      });
      expect(result.firstName).toBe('Carol');
    });

    it('propagates errors thrown by updateProfile', async () => {
      mockAuthService.syncUser = vi.fn().mockResolvedValue(dbUser);
      mockAuthService.updateProfile = vi
        .fn()
        .mockRejectedValue(new Error('DB error'));

      await expect(
        controller.updateMe(baseUser, { firstName: 'X' }),
      ).rejects.toThrow('DB error');
    });

    it('returns null for firstName when updateProfile returns null firstName', async () => {
      // dbUser has firstName: null — exercises the null branch of `updated.firstName ?? null`
      mockAuthService.syncUser = vi.fn().mockResolvedValue(dbUser);
      mockAuthService.updateProfile = vi.fn().mockResolvedValue(dbUser);

      const result = await controller.updateMe(baseUser, {});

      expect(result.firstName).toBeNull();
      expect(result.lastName).toBeNull();
      expect(result.pictureUrl).toBeNull();
    });
  });
});
