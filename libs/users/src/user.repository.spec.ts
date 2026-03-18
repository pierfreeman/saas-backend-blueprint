import { UserRepository } from './infrastructure/repositories/user.repository';
import { MembershipRole, MembershipStatus } from '@prisma/client';
import { PrismaBusinessService } from '@libs/prisma-business';

const mockPrisma = {
  user: {
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  organization: { create: jest.fn() },
  membership: { create: jest.fn() },
  $transaction: jest.fn(),
} as unknown as PrismaBusinessService;

describe('UserRepository', () => {
  let repo: UserRepository;

  beforeEach(() => {
    jest.clearAllMocks();
    repo = new UserRepository(mockPrisma);
  });

  describe('findByAuth0Id', () => {
    it('queries user by auth0Id', async () => {
      const user = { id: 'u-1', auth0Id: 'auth0|1', email: 'a@b.com' };
      mockPrisma.user.findUnique = jest.fn().mockResolvedValue(user);

      expect(await repo.findByAuth0Id('auth0|1')).toBe(user);
      expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
        where: { auth0Id: 'auth0|1' },
      });
    });

    it('returns null when not found', async () => {
      mockPrisma.user.findUnique = jest.fn().mockResolvedValue(null);
      expect(await repo.findByAuth0Id('auth0|missing')).toBeNull();
    });
  });

  describe('findById', () => {
    it('queries user by internal id', async () => {
      const user = { id: 'u-1', auth0Id: 'auth0|1', email: 'a@b.com' };
      mockPrisma.user.findUnique = jest.fn().mockResolvedValue(user);
      expect(await repo.findById('u-1')).toBe(user);
    });
  });

  describe('updateEmail', () => {
    it('updates the email field', async () => {
      const updated = { id: 'u-1', email: 'new@b.com' };
      mockPrisma.user.update = jest.fn().mockResolvedValue(updated);

      expect(await repo.updateEmail('u-1', 'new@b.com')).toBe(updated);
      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'u-1' },
        data: { email: 'new@b.com' },
      });
    });
  });

  describe('provisionWithPersonalOrg', () => {
    it('creates user + org + membership in one transaction', async () => {
      const createdUser = { id: 'u-1', auth0Id: 'auth0|1', email: 'a@b.com' };
      const createdOrg = { id: 'org-1', name: 'Personal Workspace' };

      mockPrisma.user.create = jest.fn().mockResolvedValue(createdUser);
      // Use the mock as the tx object (same pattern as existing auth spec)
      const orgCreate = jest.fn().mockResolvedValue(createdOrg);
      const membershipCreate = jest.fn().mockResolvedValue({});
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (mockPrisma as any).organization.create = orgCreate;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (mockPrisma as any).membership.create = membershipCreate;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (mockPrisma as any).$transaction = jest
        .fn()
        .mockImplementation((fn: any) => fn(mockPrisma));

      const result = await repo.provisionWithPersonalOrg('auth0|1', 'a@b.com');

      expect(result).toBe(createdUser);
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
  });
});
