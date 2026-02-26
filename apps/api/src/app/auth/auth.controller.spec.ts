import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { NotFoundException } from '@nestjs/common';
import { RequestUser } from '@libs/common';

const mockAuthService = {
  syncUser: jest.fn(),
} as unknown as AuthService;

const baseUser: RequestUser = {
  sub: 'auth0|u1',
  email: 'user@example.com',
};

const dbUser = {
  id: 'db-u-1',
  auth0Id: 'auth0|u1',
  email: 'user@example.com',
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('AuthController', () => {
  let controller: AuthController;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new AuthController(mockAuthService);
  });

  describe('getMe', () => {
    it('returns id, sub and email for an authenticated user', async () => {
      mockAuthService.syncUser = jest.fn().mockResolvedValue(dbUser);

      const result = await controller.getMe(baseUser);

      expect(result).toEqual({
        id: 'db-u-1',
        sub: 'auth0|u1',
        email: 'user@example.com',
      });
      expect(mockAuthService.syncUser).toHaveBeenCalledWith(
        'auth0|u1',
        'user@example.com',
      );
    });

    it('propagates errors thrown by syncUser', async () => {
      mockAuthService.syncUser = jest
        .fn()
        .mockRejectedValue(new Error('DB down'));

      await expect(controller.getMe(baseUser)).rejects.toThrow('DB down');
    });

    it('always uses the JWT email (not the db record email) in the response', async () => {
      const dbUserWithDifferentEmail = {
        ...dbUser,
        email: 'updated@example.com',
      };
      mockAuthService.syncUser = jest
        .fn()
        .mockResolvedValue(dbUserWithDifferentEmail);

      // JWT email is still baseUser.email
      const result = await controller.getMe(baseUser);
      expect(result.email).toBe(baseUser.email);
      expect(result.id).toBe('db-u-1');
    });
  });
});
