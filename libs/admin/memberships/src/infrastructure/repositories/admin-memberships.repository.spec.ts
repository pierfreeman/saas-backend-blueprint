import { PrismaBusinessService } from '@libs/prisma-business';
import { MembershipStatus } from '@libs/prisma-business';
import { AdminMembershipsRepository } from './admin-memberships.repository';

const mockPrisma = {
  membership: {
    findMany: vi.fn(),
    count: vi.fn(),
  },
} as unknown as PrismaBusinessService;

const mockMember = {
  id: 'mem-1',
  orgId: 'org-1',
  userId: 'user-1',
  role: 'MEMBER',
  status: MembershipStatus.ACTIVE,
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
  user: {
    id: 'user-1',
    email: 'alice@example.com',
    firstName: 'Alice',
    lastName: 'Smith',
    pictureUrl: null,
  },
};

describe('AdminMembershipsRepository', () => {
  let repo: AdminMembershipsRepository;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = new AdminMembershipsRepository(mockPrisma);
  });

  describe('findByOrgPaginated', () => {
    it('queries memberships scoped to orgId with pagination and returns total', async () => {
      (mockPrisma.membership.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(
        [mockMember],
      );
      (mockPrisma.membership.count as ReturnType<typeof vi.fn>).mockResolvedValue(1);

      const result = await repo.findByOrgPaginated('org-1', {
        limit: 50,
        offset: 0,
      });

      expect(result).toEqual({ items: [mockMember], total: 1 });
      expect(mockPrisma.membership.findMany).toHaveBeenCalledWith({
        where: { orgId: 'org-1' },
        include: { user: true },
        orderBy: { createdAt: 'asc' },
        take: 50,
        skip: 0,
      });
      expect(mockPrisma.membership.count).toHaveBeenCalledWith({
        where: { orgId: 'org-1' },
      });
    });

    it('applies the status filter when provided', async () => {
      (mockPrisma.membership.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(
        [],
      );
      (mockPrisma.membership.count as ReturnType<typeof vi.fn>).mockResolvedValue(0);

      await repo.findByOrgPaginated(
        'org-1',
        { limit: 10, offset: 5 },
        { status: MembershipStatus.PENDING },
      );

      expect(mockPrisma.membership.findMany).toHaveBeenCalledWith({
        where: { orgId: 'org-1', status: MembershipStatus.PENDING },
        include: { user: true },
        orderBy: { createdAt: 'asc' },
        take: 10,
        skip: 5,
      });
      expect(mockPrisma.membership.count).toHaveBeenCalledWith({
        where: { orgId: 'org-1', status: MembershipStatus.PENDING },
      });
    });

    it('returns an empty result set when the org has no memberships', async () => {
      (mockPrisma.membership.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(
        [],
      );
      (mockPrisma.membership.count as ReturnType<typeof vi.fn>).mockResolvedValue(0);

      const result = await repo.findByOrgPaginated('org-empty', {
        limit: 50,
        offset: 0,
      });

      expect(result).toEqual({ items: [], total: 0 });
    });
  });
});
