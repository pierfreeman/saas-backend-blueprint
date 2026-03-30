import { PrismaBusinessService } from '@libs/prisma-business';
import { MembershipRole, MembershipStatus } from '@libs/prisma-business';
import { vi } from 'vitest';
import { MembershipsRepository } from './memberships.repository';

// ── Prisma mock ──────────────────────────────────────────────────────────────

const mockPrisma = {
  membership: {
    count: vi.fn(),
    create: vi.fn(),
    findMany: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
} as unknown as PrismaBusinessService;

// ── Fixtures ─────────────────────────────────────────────────────────────────

const baseMembership = {
  id: 'm-1',
  userId: 'u-1',
  orgId: 'org-1',
  role: MembershipRole.MEMBER,
  status: MembershipStatus.ACTIVE,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const baseUser = {
  id: 'u-1',
  email: 'user@test.com',
  auth0Id: 'auth0|u-1',
  firstName: 'Test',
  lastName: 'User',
  pictureUrl: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const baseOrg = {
  id: 'org-1',
  name: 'Acme Corp',
  createdAt: new Date(),
  updatedAt: new Date(),
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('MembershipsRepository', () => {
  let repo: MembershipsRepository;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = new MembershipsRepository(mockPrisma);
  });

  // ── countActive ─────────────────────────────────────────────────────────────

  describe('countActive', () => {
    it('counts ACTIVE and INVITED memberships for the org', async () => {
      mockPrisma.membership.count = vi.fn().mockResolvedValue(5);

      const result = await repo.countActive('org-1');

      expect(result).toBe(5);
      expect(mockPrisma.membership.count).toHaveBeenCalledWith({
        where: {
          orgId: 'org-1',
          status: { in: [MembershipStatus.ACTIVE, MembershipStatus.INVITED] },
        },
      });
    });
  });

  // ── create ──────────────────────────────────────────────────────────────────

  describe('create', () => {
    it('creates a membership with the given data', async () => {
      mockPrisma.membership.create = vi.fn().mockResolvedValue(baseMembership);

      const result = await repo.create({
        userId: 'u-1',
        orgId: 'org-1',
        role: MembershipRole.MEMBER,
      });

      expect(result).toBe(baseMembership);
      expect(mockPrisma.membership.create).toHaveBeenCalledWith({
        data: { userId: 'u-1', orgId: 'org-1', role: MembershipRole.MEMBER },
      });
    });
  });

  // ── findByOrg ───────────────────────────────────────────────────────────────

  describe('findByOrg', () => {
    it('returns memberships with user data for the org', async () => {
      const membershipWithUser = { ...baseMembership, user: baseUser };
      mockPrisma.membership.findMany = vi
        .fn()
        .mockResolvedValue([membershipWithUser]);

      const result = await repo.findByOrg('org-1');

      expect(result).toEqual([membershipWithUser]);
      expect(mockPrisma.membership.findMany).toHaveBeenCalledWith({
        where: { orgId: 'org-1' },
        include: { user: true },
      });
    });
  });

  // ── findByUser ──────────────────────────────────────────────────────────────

  describe('findByUser', () => {
    it('returns memberships with organization data for the user', async () => {
      const membershipWithOrg = { ...baseMembership, organization: baseOrg };
      mockPrisma.membership.findMany = vi
        .fn()
        .mockResolvedValue([membershipWithOrg]);

      const result = await repo.findByUser('u-1');

      expect(result).toEqual([membershipWithOrg]);
      expect(mockPrisma.membership.findMany).toHaveBeenCalledWith({
        where: { userId: 'u-1' },
        include: { organization: true },
      });
    });
  });

  // ── findById ────────────────────────────────────────────────────────────────

  describe('findById', () => {
    it('returns the membership when found', async () => {
      mockPrisma.membership.findUnique = vi
        .fn()
        .mockResolvedValue(baseMembership);

      const result = await repo.findById('m-1');

      expect(result).toBe(baseMembership);
      expect(mockPrisma.membership.findUnique).toHaveBeenCalledWith({
        where: { id: 'm-1' },
      });
    });

    it('returns null when membership not found', async () => {
      mockPrisma.membership.findUnique = vi.fn().mockResolvedValue(null);

      const result = await repo.findById('m-x');

      expect(result).toBeNull();
    });
  });

  // ── findByUserAndOrg ────────────────────────────────────────────────────────

  describe('findByUserAndOrg', () => {
    it('returns the membership for a user+org combination', async () => {
      mockPrisma.membership.findUnique = vi
        .fn()
        .mockResolvedValue(baseMembership);

      const result = await repo.findByUserAndOrg('u-1', 'org-1');

      expect(result).toBe(baseMembership);
      expect(mockPrisma.membership.findUnique).toHaveBeenCalledWith({
        where: { userId_orgId: { userId: 'u-1', orgId: 'org-1' } },
      });
    });

    it('returns null when no membership exists for the combination', async () => {
      mockPrisma.membership.findUnique = vi.fn().mockResolvedValue(null);

      const result = await repo.findByUserAndOrg('u-x', 'org-x');

      expect(result).toBeNull();
    });
  });

  // ── update ──────────────────────────────────────────────────────────────────

  describe('update', () => {
    it('updates the membership role', async () => {
      const updated = { ...baseMembership, role: MembershipRole.ADMIN };
      mockPrisma.membership.update = vi.fn().mockResolvedValue(updated);

      const result = await repo.update('m-1', { role: MembershipRole.ADMIN });

      expect(result).toBe(updated);
      expect(mockPrisma.membership.update).toHaveBeenCalledWith({
        where: { id: 'm-1' },
        data: { role: MembershipRole.ADMIN },
      });
    });
  });

  // ── delete ──────────────────────────────────────────────────────────────────

  describe('delete', () => {
    it('deletes the membership by id', async () => {
      mockPrisma.membership.delete = vi.fn().mockResolvedValue(baseMembership);

      await repo.delete('m-1');

      expect(mockPrisma.membership.delete).toHaveBeenCalledWith({
        where: { id: 'm-1' },
      });
    });
  });
});
