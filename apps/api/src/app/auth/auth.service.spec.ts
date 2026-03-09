import { AuthService } from './auth.service';
import { PrismaBusinessService } from '@libs/prisma-business';
import { MembershipRole, MembershipStatus } from '@prisma/client';

// mockPrisma doubles as the transaction client (tx) because $transaction
// forwards the callback to the same mock object.
const mockPrisma = {
  user: {
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  organization: {
    create: jest.fn(),
  },
  membership: {
    create: jest.fn(),
  },
  $transaction: jest.fn(),
} as unknown as PrismaBusinessService;

describe('AuthService', () => {
  let service: AuthService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AuthService(mockPrisma);
  });

  describe('syncUser', () => {
    it('provisions new user + personal org + OWNER membership in one transaction', async () => {
      const createdUser = {
        id: 'u-1',
        auth0Id: 'auth0|1',
        email: 'a@b.com',
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      const createdOrg = { id: 'org-1', name: 'Personal Workspace' };

      mockPrisma.user.findUnique = jest.fn().mockResolvedValue(null);
      mockPrisma.user.create = jest.fn().mockResolvedValue(createdUser);
      // Use local variables to avoid jest.Mocked<> clashing with Prisma's recursive
      // conditional types, which cause TS2615 circular reference errors.
      const orgCreate = jest.fn().mockResolvedValue(createdOrg);
      const membershipCreate = jest.fn().mockResolvedValue({});
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const txFn = jest.fn().mockImplementation((fn: any) => fn(mockPrisma));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (mockPrisma as any).organization.create = orgCreate;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (mockPrisma as any).membership.create = membershipCreate;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (mockPrisma as any).$transaction = txFn;

      const result = await service.syncUser('auth0|1', 'a@b.com');

      expect(result).toBe(createdUser);
      expect(txFn).toHaveBeenCalledTimes(1);
      expect(mockPrisma.user.create).toHaveBeenCalledWith({
        data: { auth0Id: 'auth0|1', email: 'a@b.com' },
      });
      expect(orgCreate).toHaveBeenCalledWith({
        data: { name: 'Personal Workspace' },
      });
      expect(membershipCreate).toHaveBeenCalledWith({
        data: {
          userId: 'u-1',
          orgId: 'org-1',
          role: MembershipRole.OWNER,
          status: MembershipStatus.ACTIVE,
        },
      });
    });

    it('returns existing user when email is unchanged — no transaction', async () => {
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((mockPrisma as any).$transaction).not.toHaveBeenCalled();
    });

    it('updates email when it has changed — no transaction', async () => {
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((mockPrisma as any).$transaction).not.toHaveBeenCalled();
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
    it('propagates errors thrown inside the transaction', async () => {
      mockPrisma.user.findUnique = jest.fn().mockResolvedValue(null);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (mockPrisma as any).$transaction = jest
        .fn()
        .mockRejectedValue(new Error('Transaction aborted'));

      await expect(service.syncUser('auth0|new', 'new@b.com')).rejects.toThrow(
        'Transaction aborted',
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
