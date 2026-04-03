import { Test, TestingModule } from '@nestjs/testing';
import { AdminOrganizationsRepository } from './admin-organizations.repository';
import { PrismaBusinessService } from '@libs/prisma-business';
import { OrganizationStatus, BillingStatus } from '@libs/prisma-business';
import { vi } from 'vitest';

// ── Helpers ───────────────────────────────────────────────────────────────────

const makeOrg = (overrides = {}) => ({
  id: 'org-1',
  name: 'Acme Corp',
  status: OrganizationStatus.ACTIVE,
  billingStatus: BillingStatus.ACTIVE,
  planId: 'price_pro',
  stripeCustomerId: null,
  subscriptionId: null,
  subscriptionPeriodEnd: null,
  subscriptionPeriodStart: null,
  cancelAtPeriodEnd: false,
  storageLimit: null,
  deletionRequestedAt: null,
  deletionScheduledAt: null,
  deletionCompletedAt: null,
  retentionPeriodDays: null,
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-06-01'),
  _count: { memberships: 3 },
  ...overrides,
});

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockPrisma = {
  organization: {
    findMany: vi.fn(),
    count: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('AdminOrganizationsRepository', () => {
  let repository: AdminOrganizationsRepository;

  beforeEach(async () => {
    vi.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminOrganizationsRepository,
        { provide: PrismaBusinessService, useValue: mockPrisma },
      ],
    }).compile();

    repository = module.get(AdminOrganizationsRepository);
  });

  // ── findAll ───────────────────────────────────────────────────────────────

  describe('findAll', () => {
    it('returns paginated items and total', async () => {
      const org = makeOrg();
      mockPrisma.organization.findMany.mockResolvedValue([org]);
      mockPrisma.organization.count.mockResolvedValue(1);

      const result = await repository.findAll({}, { limit: 20, offset: 0 });

      expect(result.total).toBe(1);
      expect(result.items).toHaveLength(1);
      expect(result.items[0].id).toBe('org-1');
    });

    it('passes limit, offset, and ordering to prisma', async () => {
      mockPrisma.organization.findMany.mockResolvedValue([]);
      mockPrisma.organization.count.mockResolvedValue(0);

      await repository.findAll({}, { limit: 10, offset: 30 });

      expect(mockPrisma.organization.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 10,
          skip: 30,
          orderBy: { createdAt: 'desc' },
          include: { _count: { select: { memberships: true } } },
        }),
      );
    });

    it('builds OR clause with only name filter when search is not a UUID', async () => {
      mockPrisma.organization.findMany.mockResolvedValue([]);
      mockPrisma.organization.count.mockResolvedValue(0);

      await repository.findAll(
        { search: '  Acme  ' },
        { limit: 20, offset: 0 },
      );

      expect(mockPrisma.organization.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: [{ name: { contains: 'Acme', mode: 'insensitive' } }],
          }),
        }),
      );
    });

    it('builds OR clause with name and id filters when search is a valid UUID', async () => {
      mockPrisma.organization.findMany.mockResolvedValue([]);
      mockPrisma.organization.count.mockResolvedValue(0);

      const uuid = 'a1b2c3d4-e5f6-4789-ab01-cd2345ef6789';
      await repository.findAll({ search: uuid }, { limit: 20, offset: 0 });

      expect(mockPrisma.organization.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: [
              { name: { contains: uuid, mode: 'insensitive' } },
              { id: uuid },
            ],
          }),
        }),
      );
    });

    it('adds status filter when status is provided', async () => {
      mockPrisma.organization.findMany.mockResolvedValue([]);
      mockPrisma.organization.count.mockResolvedValue(0);

      await repository.findAll(
        { status: OrganizationStatus.SUSPENDED },
        { limit: 20, offset: 0 },
      );

      expect(mockPrisma.organization.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: OrganizationStatus.SUSPENDED,
          }),
        }),
      );
    });

    it('applies both search and status filters together', async () => {
      mockPrisma.organization.findMany.mockResolvedValue([]);
      mockPrisma.organization.count.mockResolvedValue(0);

      await repository.findAll(
        { search: 'Acme', status: OrganizationStatus.ACTIVE },
        { limit: 20, offset: 0 },
      );

      const call = mockPrisma.organization.findMany.mock.calls[0][0];
      expect(call.where).toHaveProperty('OR');
      expect(call.where).toHaveProperty('status', OrganizationStatus.ACTIVE);
    });

    it('uses empty where clause when no filters provided', async () => {
      mockPrisma.organization.findMany.mockResolvedValue([]);
      mockPrisma.organization.count.mockResolvedValue(0);

      await repository.findAll({}, { limit: 20, offset: 0 });

      const call = mockPrisma.organization.findMany.mock.calls[0][0];
      expect(call.where).toEqual({});
    });

    it('runs count and findMany in parallel', async () => {
      let findManyResolved = false;
      let countResolved = false;

      mockPrisma.organization.findMany.mockImplementation(async () => {
        findManyResolved = true;
        return [];
      });
      mockPrisma.organization.count.mockImplementation(async () => {
        countResolved = true;
        return 0;
      });

      await repository.findAll({}, { limit: 20, offset: 0 });

      expect(findManyResolved).toBe(true);
      expect(countResolved).toBe(true);
    });
  });

  // ── findByIdWithMemberCount ───────────────────────────────────────────────

  describe('findByIdWithMemberCount', () => {
    it('returns org with member count when found', async () => {
      const org = makeOrg();
      mockPrisma.organization.findUnique.mockResolvedValue(org);

      const result = await repository.findByIdWithMemberCount('org-1');

      expect(result).toBe(org);
      expect(mockPrisma.organization.findUnique).toHaveBeenCalledWith({
        where: { id: 'org-1' },
        include: { _count: { select: { memberships: true } } },
      });
    });

    it('returns null when org does not exist', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue(null);

      const result = await repository.findByIdWithMemberCount('missing');

      expect(result).toBeNull();
    });
  });

  // ── createOrg ─────────────────────────────────────────────────────────────

  describe('createOrg', () => {
    it('creates org with given name and returns it', async () => {
      const org = makeOrg({ name: 'New Startup' });
      mockPrisma.organization.create.mockResolvedValue(org);

      const result = await repository.createOrg('New Startup');

      expect(result).toBe(org);
      expect(mockPrisma.organization.create).toHaveBeenCalledWith({
        data: { name: 'New Startup' },
      });
    });
  });

  // ── updatePlanId ──────────────────────────────────────────────────────────

  describe('updatePlanId', () => {
    it('updates planId for the given org', async () => {
      mockPrisma.organization.update.mockResolvedValue(undefined);

      await repository.updatePlanId('org-1', 'price_enterprise');

      expect(mockPrisma.organization.update).toHaveBeenCalledWith({
        where: { id: 'org-1' },
        data: { planId: 'price_enterprise' },
      });
    });
  });

  // ── updateStatus ──────────────────────────────────────────────────────────

  describe('updateStatus', () => {
    it('updates status and returns org with member count', async () => {
      const suspended = makeOrg({ status: OrganizationStatus.SUSPENDED });
      mockPrisma.organization.update.mockResolvedValue(suspended);

      const result = await repository.updateStatus(
        'org-1',
        OrganizationStatus.SUSPENDED,
      );

      expect(result).toBe(suspended);
      expect(mockPrisma.organization.update).toHaveBeenCalledWith({
        where: { id: 'org-1' },
        data: { status: OrganizationStatus.SUSPENDED },
        include: { _count: { select: { memberships: true } } },
      });
    });
  });
});
