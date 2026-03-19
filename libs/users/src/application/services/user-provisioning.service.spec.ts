import { UserProvisioningService } from './user-provisioning.service';
import { UserRepository } from '../../infrastructure/repositories/user.repository';

const mockUserRepository = {
  provisionWithPersonalOrg: jest.fn(),
} as unknown as UserRepository;

describe('UserProvisioningService', () => {
  let service: UserProvisioningService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new UserProvisioningService(mockUserRepository);
  });

  describe('provisionWithPersonalOrg', () => {
    it('delegates to UserRepository and returns the created user', async () => {
      const user = {
        id: 'u-1',
        auth0Id: 'auth0|1',
        email: 'a@b.com',
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      mockUserRepository.provisionWithPersonalOrg = jest
        .fn()
        .mockResolvedValue(user);

      const result = await service.provisionWithPersonalOrg(
        'auth0|1',
        'a@b.com',
      );

      expect(result).toBe(user);
      expect(mockUserRepository.provisionWithPersonalOrg).toHaveBeenCalledWith(
        'auth0|1',
        'a@b.com',
      );
    });

    it('propagates errors from the repository', async () => {
      mockUserRepository.provisionWithPersonalOrg = jest
        .fn()
        .mockRejectedValue(new Error('Transaction aborted'));

      await expect(
        service.provisionWithPersonalOrg('auth0|1', 'a@b.com'),
      ).rejects.toThrow('Transaction aborted');
    });
  });
});
