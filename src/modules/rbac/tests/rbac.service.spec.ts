import { Test, TestingModule } from '@nestjs/testing';
import { RBACService } from '../services/rbac.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { MembershipRole, MembershipStatus } from '@prisma/client';
import { PERMISSIONS } from '../constants/permissions.constants';

describe('RBACService', () => {
  let service: RBACService;
  let prisma: PrismaService;

  const mockPrismaService = {
    role: {
      findMany: jest.fn(),
    },
    membership: {
      findUnique: jest.fn(),
    },
    permission: {
      findMany: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RBACService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
      ],
    }).compile();

    service = module.get<RBACService>(RBACService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('resolveContext', () => {
    it('should return null if membership not found', async () => {
      mockPrismaService.membership.findUnique.mockResolvedValue(null);

      const result = await service.resolveContext('user-1', 'org-1');

      expect(result).toBeNull();
    });

    it('should return RBAC context with permissions', async () => {
      const mockMembership = {
        id: 'membership-1',
        userId: 'user-1',
        orgId: 'org-1',
        role: MembershipRole.ADMIN,
        status: MembershipStatus.ACTIVE,
      };

      mockPrismaService.membership.findUnique.mockResolvedValue(mockMembership);

      // Mock getPermissionsForRole
      jest
        .spyOn(service, 'getPermissionsForRole')
        .mockReturnValue([PERMISSIONS.TEAM_CREATE, PERMISSIONS.TEAM_READ]);

      const result = await service.resolveContext('user-1', 'org-1');

      expect(result).toEqual({
        userId: 'user-1',
        orgId: 'org-1',
        role: MembershipRole.ADMIN,
        status: MembershipStatus.ACTIVE,
        permissions: [PERMISSIONS.TEAM_CREATE, PERMISSIONS.TEAM_READ],
      });
    });
  });

  describe('hasPermission', () => {
    it('should return false if user not a member', async () => {
      mockPrismaService.membership.findUnique.mockResolvedValue(null);

      const result = await service.hasPermission('user-1', 'org-1', PERMISSIONS.TEAM_CREATE);

      expect(result).toBe(false);
    });

    it('should return false if membership not active', async () => {
      mockPrismaService.membership.findUnique.mockResolvedValue({
        id: 'membership-1',
        userId: 'user-1',
        orgId: 'org-1',
        role: MembershipRole.ADMIN,
        status: MembershipStatus.SUSPENDED,
      });

      const result = await service.hasPermission('user-1', 'org-1', PERMISSIONS.TEAM_CREATE);

      expect(result).toBe(false);
    });

    it('should return true if user has permission', async () => {
      mockPrismaService.membership.findUnique.mockResolvedValue({
        id: 'membership-1',
        userId: 'user-1',
        orgId: 'org-1',
        role: MembershipRole.ADMIN,
        status: MembershipStatus.ACTIVE,
      });

      jest
        .spyOn(service, 'getPermissionsForRole')
        .mockReturnValue([PERMISSIONS.TEAM_CREATE, PERMISSIONS.TEAM_READ]);

      const result = await service.hasPermission('user-1', 'org-1', PERMISSIONS.TEAM_CREATE);

      expect(result).toBe(true);
    });

    it('should return false if user does not have permission', async () => {
      mockPrismaService.membership.findUnique.mockResolvedValue({
        id: 'membership-1',
        userId: 'user-1',
        orgId: 'org-1',
        role: MembershipRole.READ_ONLY,
        status: MembershipStatus.ACTIVE,
      });

      jest.spyOn(service, 'getPermissionsForRole').mockReturnValue([PERMISSIONS.TEAM_READ]);

      const result = await service.hasPermission('user-1', 'org-1', PERMISSIONS.TEAM_CREATE);

      expect(result).toBe(false);
    });
  });

  describe('hasAnyPermission', () => {
    it('should return true if user has at least one permission', async () => {
      mockPrismaService.membership.findUnique.mockResolvedValue({
        id: 'membership-1',
        userId: 'user-1',
        orgId: 'org-1',
        role: MembershipRole.MEMBER,
        status: MembershipStatus.ACTIVE,
      });

      jest
        .spyOn(service, 'getPermissionsForRole')
        .mockReturnValue([PERMISSIONS.TEAM_READ, PERMISSIONS.PLAYER_READ]);

      const result = await service.hasAnyPermission('user-1', 'org-1', [
        PERMISSIONS.TEAM_DELETE,
        PERMISSIONS.TEAM_READ,
      ]);

      expect(result).toBe(true);
    });

    it('should return false if user has none of the permissions', async () => {
      mockPrismaService.membership.findUnique.mockResolvedValue({
        id: 'membership-1',
        userId: 'user-1',
        orgId: 'org-1',
        role: MembershipRole.READ_ONLY,
        status: MembershipStatus.ACTIVE,
      });

      jest.spyOn(service, 'getPermissionsForRole').mockReturnValue([PERMISSIONS.TEAM_READ]);

      const result = await service.hasAnyPermission('user-1', 'org-1', [
        PERMISSIONS.TEAM_DELETE,
        PERMISSIONS.TEAM_CREATE,
      ]);

      expect(result).toBe(false);
    });
  });

  describe('hasAllPermissions', () => {
    it('should return true if user has all permissions', async () => {
      mockPrismaService.membership.findUnique.mockResolvedValue({
        id: 'membership-1',
        userId: 'user-1',
        orgId: 'org-1',
        role: MembershipRole.ADMIN,
        status: MembershipStatus.ACTIVE,
      });

      jest
        .spyOn(service, 'getPermissionsForRole')
        .mockReturnValue([PERMISSIONS.TEAM_CREATE, PERMISSIONS.TEAM_READ, PERMISSIONS.TEAM_UPDATE]);

      const result = await service.hasAllPermissions('user-1', 'org-1', [
        PERMISSIONS.TEAM_CREATE,
        PERMISSIONS.TEAM_READ,
      ]);

      expect(result).toBe(true);
    });

    it('should return false if user missing one permission', async () => {
      mockPrismaService.membership.findUnique.mockResolvedValue({
        id: 'membership-1',
        userId: 'user-1',
        orgId: 'org-1',
        role: MembershipRole.MEMBER,
        status: MembershipStatus.ACTIVE,
      });

      jest.spyOn(service, 'getPermissionsForRole').mockReturnValue([PERMISSIONS.TEAM_READ]);

      const result = await service.hasAllPermissions('user-1', 'org-1', [
        PERMISSIONS.TEAM_CREATE,
        PERMISSIONS.TEAM_READ,
      ]);

      expect(result).toBe(false);
    });
  });

  describe('hasRole', () => {
    it('should return true if user has the role', async () => {
      mockPrismaService.membership.findUnique.mockResolvedValue({
        id: 'membership-1',
        userId: 'user-1',
        orgId: 'org-1',
        role: MembershipRole.ADMIN,
        status: MembershipStatus.ACTIVE,
      });

      const result = await service.hasRole('user-1', 'org-1', [
        MembershipRole.ADMIN,
        MembershipRole.OWNER,
      ]);

      expect(result).toBe(true);
    });

    it('should return false if user does not have the role', async () => {
      mockPrismaService.membership.findUnique.mockResolvedValue({
        id: 'membership-1',
        userId: 'user-1',
        orgId: 'org-1',
        role: MembershipRole.MEMBER,
        status: MembershipStatus.ACTIVE,
      });

      const result = await service.hasRole('user-1', 'org-1', [MembershipRole.ADMIN]);

      expect(result).toBe(false);
    });

    it('should return false if membership not active', async () => {
      mockPrismaService.membership.findUnique.mockResolvedValue({
        id: 'membership-1',
        userId: 'user-1',
        orgId: 'org-1',
        role: MembershipRole.ADMIN,
        status: MembershipStatus.INVITED,
      });

      const result = await service.hasRole('user-1', 'org-1', [MembershipRole.ADMIN]);

      expect(result).toBe(false);
    });
  });
});
