import { PrismaBusinessService } from '@libs/prisma-business';
import { MembershipRole } from '@libs/prisma-business';
import { Mock, vi } from 'vitest';
import { OrganizationsRepository } from './organizations.repository';

// ── Prisma mock ──────────────────────────────────────────────────────────────

const mockTx = {
  organization: { create: vi.fn() },
  membership: { create: vi.fn() },
  $executeRaw: vi.fn(),
};

const mockPrisma = {
  organization: {
    findUnique: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  membership: {
    findMany: vi.fn(),
  },
  job: {
    deleteMany: vi.fn(),
  },
  $transaction: vi.fn(),
} as unknown as PrismaBusinessService;

// ── Shared fixtures ──────────────────────────────────────────────────────────

const baseOrg = {
  id: 'org-1',
  name: 'Acme',
  createdAt: new Date(),
  updatedAt: new Date(),
};

// ── Tests ────────────────────────────────────────────────────────────────────

describe('OrganizationsRepository', () => {
  let repo: OrganizationsRepository;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = new OrganizationsRepository(mockPrisma);
  });

  // ── createWithOwner ────────────────────────────────────────────────────────

  describe('createWithOwner', () => {
    it('creates organization and assigns OWNER membership in a transaction', async () => {
      mockTx.organization.create.mockResolvedValue(baseOrg);
      mockTx.membership.create.mockResolvedValue({});
      (mockPrisma.$transaction as Mock).mockImplementation(
        (fn: (tx: typeof mockTx) => Promise<unknown>) => fn(mockTx),
      );

      const result = await repo.createWithOwner('Acme', 'u-1');

      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);

      // id is generated client-side (uuidv4()) so app.current_org_id can be
      // set before either INSERT runs (required by both tables' RLS
      // WITH CHECK) — assert it's a valid UUID and that the same value was
      // used for both the set_config call and the organization INSERT.
      const createCall = mockTx.organization.create.mock.calls[0][0];
      const generatedId = createCall.data.id;
      expect(generatedId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      );
      expect(createCall).toEqual({ data: { id: generatedId, name: 'Acme' } });

      const executeRawCall = mockTx.$executeRaw.mock.calls[0];
      expect(executeRawCall[1]).toBe(generatedId);

      expect(mockTx.membership.create).toHaveBeenCalledWith({
        data: { userId: 'u-1', orgId: 'org-1', role: MembershipRole.OWNER },
      });
      expect(result).toBe(baseOrg);
    });
  });

  // ── findById ───────────────────────────────────────────────────────────────

  describe('findById', () => {
    it('returns organization when found', async () => {
      mockPrisma.organization.findUnique = vi.fn().mockResolvedValue(baseOrg);

      const result = await repo.findById('org-1');

      expect(result).toBe(baseOrg);
      expect(mockPrisma.organization.findUnique).toHaveBeenCalledWith({
        where: { id: 'org-1' },
      });
    });

    it('returns null when organization does not exist', async () => {
      mockPrisma.organization.findUnique = vi.fn().mockResolvedValue(null);

      const result = await repo.findById('nonexistent');

      expect(result).toBeNull();
    });
  });

  // ── findByUserId ───────────────────────────────────────────────────────────

  describe('findByUserId', () => {
    it('returns organizations mapped from memberships', async () => {
      const memberships = [
        { organization: baseOrg },
        {
          organization: {
            id: 'org-2',
            name: 'Beta',
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        },
      ];
      mockPrisma.membership.findMany = vi.fn().mockResolvedValue(memberships);

      const result = await repo.findByUserId('u-1');

      expect(result).toHaveLength(2);
      expect(result[0]).toBe(baseOrg);
      expect(mockPrisma.membership.findMany).toHaveBeenCalledWith({
        where: { userId: 'u-1' },
        include: { organization: true },
      });
    });

    it('returns empty array when user has no memberships', async () => {
      mockPrisma.membership.findMany = vi.fn().mockResolvedValue([]);

      const result = await repo.findByUserId('u-none');

      expect(result).toEqual([]);
    });
  });

  // ── update ─────────────────────────────────────────────────────────────────

  describe('update', () => {
    it('updates organization with provided data and returns updated record', async () => {
      const updated = { ...baseOrg, name: 'NewName' };
      mockPrisma.organization.update = vi.fn().mockResolvedValue(updated);

      const result = await repo.update('org-1', { name: 'NewName' });

      expect(result).toBe(updated);
      expect(mockPrisma.organization.update).toHaveBeenCalledWith({
        where: { id: 'org-1' },
        data: { name: 'NewName' },
      });
    });

    it('can update with an empty data object', async () => {
      mockPrisma.organization.update = vi.fn().mockResolvedValue(baseOrg);

      const result = await repo.update('org-1', {});

      expect(result).toBe(baseOrg);
      expect(mockPrisma.organization.update).toHaveBeenCalledWith({
        where: { id: 'org-1' },
        data: {},
      });
    });
  });

  // ── deleteJobs ─────────────────────────────────────────────────────────────

  describe('deleteJobs', () => {
    it('deletes all jobs belonging to the organization', async () => {
      mockPrisma.job.deleteMany = vi.fn().mockResolvedValue({ count: 3 });

      await repo.deleteJobs('org-1');

      expect(mockPrisma.job.deleteMany).toHaveBeenCalledWith({
        where: { orgId: 'org-1' },
      });
    });

    it('succeeds even when there are no jobs to delete', async () => {
      mockPrisma.job.deleteMany = vi.fn().mockResolvedValue({ count: 0 });

      await expect(repo.deleteJobs('org-empty')).resolves.not.toThrow();
    });
  });

  // ── delete ─────────────────────────────────────────────────────────────────

  describe('delete', () => {
    it('deletes the organization by id', async () => {
      mockPrisma.organization.delete = vi.fn().mockResolvedValue(baseOrg);

      await repo.delete('org-1');

      expect(mockPrisma.organization.delete).toHaveBeenCalledWith({
        where: { id: 'org-1' },
      });
    });
  });
});
