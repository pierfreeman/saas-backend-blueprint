import { UserRepository } from './user.repository';
import { MembershipRole, MembershipStatus } from '@prisma/client';
import { PrismaBusinessService } from '@libs/prisma-business';
import { vi } from 'vitest';

const mockPrisma = {
  user: {
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  organization: { create: vi.fn() },
  membership: { create: vi.fn() },
  $transaction: vi.fn(),
} as unknown as PrismaBusinessService;

describe('UserRepository', () => {
  let repo: UserRepository;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = new UserRepository(mockPrisma);
  });

  describe('findByAuth0Id', () => {
    it('queries user by auth0Id', async () => {
      const user = { id: 'u-1', auth0Id: 'auth0|1', email: 'a@b.com' };
      mockPrisma.user.findUnique = vi.fn().mockResolvedValue(user);

      expect(await repo.findByAuth0Id('auth0|1')).toBe(user);
      expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
        where: { auth0Id: 'auth0|1' },
      });
    });

    it('returns null when not found', async () => {
      mockPrisma.user.findUnique = vi.fn().mockResolvedValue(null);
      expect(await repo.findByAuth0Id('auth0|missing')).toBeNull();
    });
  });

  describe('findById', () => {
    it('queries user by internal id', async () => {
      const user = { id: 'u-1', auth0Id: 'auth0|1', email: 'a@b.com' };
      mockPrisma.user.findUnique = vi.fn().mockResolvedValue(user);
      expect(await repo.findById('u-1')).toBe(user);
    });
  });

  describe('updateEmail', () => {
    it('updates the email field', async () => {
      const updated = { id: 'u-1', email: 'new@b.com' };
      mockPrisma.user.update = vi.fn().mockResolvedValue(updated);

      expect(await repo.updateEmail('u-1', 'new@b.com')).toBe(updated);
      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'u-1' },
        data: { email: 'new@b.com' },
      });
    });
  });

  describe('createUser', () => {
    it('creates a bare user row without provisioning an org', async () => {
      const newUser = { id: 'u-2', auth0Id: 'auth0|2', email: 'b@b.com' };
      mockPrisma.user.create = vi.fn().mockResolvedValue(newUser);

      expect(await repo.createUser('auth0|2', 'b@b.com')).toBe(newUser);
      expect(mockPrisma.user.create).toHaveBeenCalledWith({
        data: { auth0Id: 'auth0|2', email: 'b@b.com' },
      });
    });
  });

  describe('provisionWithPersonalOrg', () => {
    it('creates user + org + membership in one transaction', async () => {
      const createdUser = { id: 'u-1', auth0Id: 'auth0|1', email: 'a@b.com' };
      const createdOrg = { id: 'org-1', name: 'Personal Workspace' };

      mockPrisma.user.create = vi.fn().mockResolvedValue(createdUser);
      // Use the mock as the tx object (same pattern as existing auth spec)
      const orgCreate = vi.fn().mockResolvedValue(createdOrg);
      const membershipCreate = vi.fn().mockResolvedValue({});
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (mockPrisma as any).organization.create = orgCreate;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (mockPrisma as any).membership.create = membershipCreate;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (mockPrisma as any).$transaction = vi
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

  describe('updateProfile', () => {
    it('updates all profile fields', async () => {
      const updated = {
        id: 'u-1',
        firstName: 'Alice',
        lastName: 'Smith',
        pictureUrl: 'https://example.com/pic.jpg',
      };
      mockPrisma.user.update = vi.fn().mockResolvedValue(updated);

      const result = await repo.updateProfile('u-1', {
        firstName: 'Alice',
        lastName: 'Smith',
        pictureUrl: 'https://example.com/pic.jpg',
      });

      expect(result).toBe(updated);
      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'u-1' },
        data: {
          firstName: 'Alice',
          lastName: 'Smith',
          pictureUrl: 'https://example.com/pic.jpg',
        },
      });
    });

    it('allows partial updates (only provided fields)', async () => {
      const updated = { id: 'u-1', firstName: 'Bob' };
      mockPrisma.user.update = vi.fn().mockResolvedValue(updated);

      const result = await repo.updateProfile('u-1', { firstName: 'Bob' });

      expect(result).toBe(updated);
      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'u-1' },
        data: { firstName: 'Bob' },
      });
    });
  });
});
