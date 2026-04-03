import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import {
  OrganizationStatus,
  BillingStatus,
  MembershipRole,
} from '@libs/prisma-business';
import { AdminOrganizationsService } from './admin-organizations.service';
import { AdminOrganizationsRepository } from '../../infrastructure/repositories/admin-organizations.repository';
import { ActivityLogService } from '@libs/activity-log';
import { FeatureFlagsService } from '@libs/feature-flags';
import { InviteMemberService } from '@libs/memberships';

const mockOrg = {
  id: 'org-1',
  name: 'Acme Corp',
  status: OrganizationStatus.ACTIVE,
  billingStatus: BillingStatus.ACTIVE,
  planId: 'price_pro',
  stripeCustomerId: 'cus_abc',
  subscriptionId: 'sub_xyz',
  subscriptionPeriodEnd: new Date('2025-01-01'),
  cancelAtPeriodEnd: false,
  storageLimit: null,
  subscriptionPeriodStart: null,
  deletionRequestedAt: null,
  deletionScheduledAt: null,
  deletionCompletedAt: null,
  retentionPeriodDays: null,
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-06-01'),
  _count: { memberships: 5 },
};

const mockActivity = {
  logs: [
    {
      id: 'log-1',
      orgId: 'org-1',
      actorId: 'user-1',
      actorRole: 'OWNER',
      action: 'org.created',
      entityType: null,
      entityId: null,
      metadata: {},
      createdAt: new Date(),
    },
  ],
  total: 1,
  limit: 5,
  offset: 0,
};

const mockEntitlements = {
  organizationId: 'org-1',
  plan: 'PRO',
  subscriptionStatus: 'ACTIVE',
  advancedAnalytics: true,
  customReports: true,
  apiAccess: true,
  ssoEnabled: false,
  prioritySupport: false,
  maxSeats: 10,
  storageLimitBytes: 5 * 1024 * 1024 * 1024,
};

describe('AdminOrganizationsService', () => {
  let service: AdminOrganizationsService;

  const mockRepository = {
    findAll: vi.fn(),
    findByIdWithMemberCount: vi.fn(),
    createOrg: vi.fn(),
    updatePlanId: vi.fn(),
  };

  const mockActivityLog = {
    findByOrg: vi.fn(),
    logActivity: vi.fn(),
  };

  const mockFeatureFlags = {
    getEntitlements: vi.fn(),
  };

  const mockInviteMember = {
    invite: vi.fn(),
  };

  beforeEach(async () => {
    vi.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminOrganizationsService,
        { provide: AdminOrganizationsRepository, useValue: mockRepository },
        { provide: ActivityLogService, useValue: mockActivityLog },
        { provide: FeatureFlagsService, useValue: mockFeatureFlags },
        { provide: InviteMemberService, useValue: mockInviteMember },
      ],
    }).compile();

    service = module.get(AdminOrganizationsService);
  });

  describe('listOrganizations', () => {
    it('returns paginated list from repository', async () => {
      mockRepository.findAll.mockResolvedValue({ items: [mockOrg], total: 1 });

      const result = await service.listOrganizations(
        {},
        { limit: 20, offset: 0 },
      );

      expect(result.total).toBe(1);
      expect(result.items).toHaveLength(1);
      expect(result.items[0].id).toBe('org-1');
      expect(result.items[0].membersCount).toBe(5);
    });

    it('caps limit at 100', async () => {
      mockRepository.findAll.mockResolvedValue({ items: [], total: 0 });

      await service.listOrganizations({}, { limit: 999 });

      expect(mockRepository.findAll).toHaveBeenCalledWith(
        {},
        { limit: 100, offset: 0 },
      );
    });

    it('uses default limit 20 when not provided', async () => {
      mockRepository.findAll.mockResolvedValue({ items: [], total: 0 });

      await service.listOrganizations();

      expect(mockRepository.findAll).toHaveBeenCalledWith(
        {},
        { limit: 20, offset: 0 },
      );
    });
  });

  describe('getOrganizationDetail', () => {
    it('returns Customer 360 when org exists', async () => {
      mockRepository.findByIdWithMemberCount.mockResolvedValue(mockOrg);
      mockActivityLog.findByOrg.mockResolvedValue(mockActivity);
      mockFeatureFlags.getEntitlements.mockResolvedValue(mockEntitlements);

      const result = await service.getOrganizationDetail('org-1');

      expect(result.id).toBe('org-1');
      expect(result.membersCount).toBe(5);
      expect(result.recentActivity).toHaveLength(1);
      expect(result.entitlements.plan).toBe('PRO');
      expect(result.stripeCustomerId).toBe('cus_abc');
    });

    it('throws NotFoundException when org does not exist', async () => {
      mockRepository.findByIdWithMemberCount.mockResolvedValue(null);

      await expect(service.getOrganizationDetail('missing-id')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('fetches activity log and entitlements in parallel', async () => {
      mockRepository.findByIdWithMemberCount.mockResolvedValue(mockOrg);
      mockActivityLog.findByOrg.mockResolvedValue(mockActivity);
      mockFeatureFlags.getEntitlements.mockResolvedValue(mockEntitlements);

      await service.getOrganizationDetail('org-1');

      expect(mockActivityLog.findByOrg).toHaveBeenCalledWith('org-1', {
        limit: 5,
        offset: 0,
      });
      expect(mockFeatureFlags.getEntitlements).toHaveBeenCalledWith('org-1');
    });
  });

  describe('searchOrganizations', () => {
    it('delegates to repository with search filter and limit cap', async () => {
      mockRepository.findAll.mockResolvedValue({ items: [mockOrg], total: 1 });

      const result = await service.searchOrganizations('Acme');

      expect(mockRepository.findAll).toHaveBeenCalledWith(
        { search: 'Acme' },
        { limit: 10, offset: 0 },
      );
      expect(result).toHaveLength(1);
    });

    it('caps search limit at 10', async () => {
      mockRepository.findAll.mockResolvedValue({ items: [], total: 0 });

      await service.searchOrganizations('test', 999);

      expect(mockRepository.findAll).toHaveBeenCalledWith(
        { search: 'test' },
        { limit: 10, offset: 0 },
      );
    });
  });

  describe('provisionOrganization', () => {
    const newOrg = {
      ...mockOrg,
      id: 'org-new',
      name: 'Startup Inc',
      planId: null,
      _count: { memberships: 0 },
    };

    it('creates org, updates planId, invites owner, logs activity', async () => {
      mockRepository.createOrg.mockResolvedValue(newOrg);
      mockRepository.updatePlanId.mockResolvedValue(undefined);
      mockInviteMember.invite.mockResolvedValue({ userId: 'user-new' });

      const result = await service.provisionOrganization(
        { name: 'Startup Inc', ownerEmail: 'ceo@startup.com', plan: 'PRO' },
        'admin-user-1',
      );

      expect(mockRepository.createOrg).toHaveBeenCalledWith('Startup Inc');
      expect(mockRepository.updatePlanId).toHaveBeenCalledWith(
        'org-new',
        'PRO',
      );
      expect(mockInviteMember.invite).toHaveBeenCalledWith(
        'ceo@startup.com',
        MembershipRole.OWNER,
        'org-new',
        'admin-user-1',
        'admin_action',
      );
      expect(mockActivityLog.logActivity).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'organization.provisioned',
          orgId: 'org-new',
        }),
      );
      expect(result.id).toBe('org-new');
      expect(result.planId).toBe('PRO');
      expect(result.membersCount).toBe(1);
    });

    it('skips updatePlanId when plan is not provided', async () => {
      mockRepository.createOrg.mockResolvedValue(newOrg);
      mockInviteMember.invite.mockResolvedValue({ userId: 'user-new' });

      await service.provisionOrganization(
        { name: 'Startup Inc', ownerEmail: 'ceo@startup.com' },
        'admin-user-1',
      );

      expect(mockRepository.updatePlanId).not.toHaveBeenCalled();
    });
  });
});
