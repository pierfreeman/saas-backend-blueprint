import { MembershipsController } from './memberships.controller';
import { MembershipsService } from '@libs/memberships';
import { RBACCacheService } from '@libs/rbac';
import { MembershipRole, MembershipStatus } from '@prisma/client';

const mockMembershipsService = {
  createMembership: jest.fn(),
  findByOrg: jest.fn(),
  updateMembership: jest.fn(),
  deleteMembership: jest.fn(),
} as unknown as MembershipsService;

const mockRBACCacheService = {
  invalidate: jest.fn().mockResolvedValue(undefined),
  invalidateOrg: jest.fn().mockResolvedValue(undefined),
} as unknown as RBACCacheService;

const baseMembership = {
  id: 'm-1',
  userId: 'u-1',
  orgId: 'org-1',
  role: 'MEMBER' as MembershipRole,
  status: 'ACTIVE' as MembershipStatus,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('MembershipsController', () => {
  let controller: MembershipsController;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new MembershipsController(
      mockMembershipsService,
      mockRBACCacheService,
    );
  });

  describe('create()', () => {
    it('creates a membership and returns the result', async () => {
      mockMembershipsService.createMembership = jest
        .fn()
        .mockResolvedValue(baseMembership);

      const result = await controller.create('org-1', {
        userId: 'u-1',
        role: 'MEMBER' as MembershipRole,
      });

      expect(result).toBe(baseMembership);
      expect(mockMembershipsService.createMembership).toHaveBeenCalledWith(
        'org-1',
        { userId: 'u-1', role: 'MEMBER' },
      );
    });

    it('propagates errors from the service', async () => {
      mockMembershipsService.createMembership = jest
        .fn()
        .mockRejectedValue(new Error('Duplicate membership'));

      await expect(
        controller.create('org-1', {
          userId: 'u-1',
          role: 'MEMBER' as MembershipRole,
        }),
      ).rejects.toThrow('Duplicate membership');
    });
  });

  describe('findByOrg()', () => {
    it('returns the list of memberships for an org', async () => {
      const list = [baseMembership, { ...baseMembership, id: 'm-2' }];
      mockMembershipsService.findByOrg = jest.fn().mockResolvedValue(list);

      const result = await controller.findByOrg('org-1');
      expect(result).toBe(list);
      expect(mockMembershipsService.findByOrg).toHaveBeenCalledWith('org-1');
    });

    it('returns an empty array when the org has no members', async () => {
      mockMembershipsService.findByOrg = jest.fn().mockResolvedValue([]);
      expect(await controller.findByOrg('org-empty')).toEqual([]);
    });
  });

  describe('update()', () => {
    it('updates a membership role and returns the updated entity', async () => {
      const updated = { ...baseMembership, role: 'ADMIN' as MembershipRole };
      mockMembershipsService.updateMembership = jest
        .fn()
        .mockResolvedValue(updated);

      const result = await controller.update('org-1', 'm-1', {
        role: 'ADMIN' as MembershipRole,
      });

      expect(result).toBe(updated);
      expect(mockMembershipsService.updateMembership).toHaveBeenCalledWith(
        'm-1',
        'org-1',
        { role: 'ADMIN' },
      );
    });

    it('propagates NotFoundException from service', async () => {
      const { NotFoundException } = jest.requireActual('@nestjs/common');
      mockMembershipsService.updateMembership = jest
        .fn()
        .mockRejectedValue(new NotFoundException('Membership not found'));

      await expect(
        controller.update('org-1', 'm-x', { role: 'ADMIN' as MembershipRole }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('delete()', () => {
    it('deletes a membership and returns a success message', async () => {
      mockMembershipsService.deleteMembership = jest
        .fn()
        .mockResolvedValue(undefined);

      const result = await controller.delete('org-1', 'm-1');
      expect(result).toEqual({ message: 'Membership deleted successfully' });
      expect(mockMembershipsService.deleteMembership).toHaveBeenCalledWith(
        'm-1',
        'org-1',
      );
    });

    it('propagates NotFoundException from service', async () => {
      const { NotFoundException } = jest.requireActual('@nestjs/common');
      mockMembershipsService.deleteMembership = jest
        .fn()
        .mockRejectedValue(new NotFoundException('Membership not found'));

      await expect(controller.delete('org-1', 'm-x')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
