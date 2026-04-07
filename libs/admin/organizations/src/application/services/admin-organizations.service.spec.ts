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
import { LegalAuditService } from '@libs/legal-audit';
import { InviteMemberService } from '@libs/memberships';
import { OrgExportService } from '@libs/org-export';
import { StorageService } from '@libs/storage';

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
    updateStatus: vi.fn(),
  };

  const mockActivityLog = {
    findByOrg: vi.fn(),
    logActivity: vi.fn(),
  };

  const mockFeatureFlags = {
    getEntitlements: vi.fn(),
    invalidateEntitlements: vi.fn(),
  };

  const mockLegalAudit = {
    recordEvent: vi.fn(),
  };

  const mockInviteMember = {
    invite: vi.fn(),
  };

  const mockOrgExport = {
    requestExport: vi.fn(),
    listExports: vi.fn(),
    countExports: vi.fn(),
    getExport: vi.fn(),
  };

  const mockStorageService = {
    getStorageStats: vi.fn(),
  };

  beforeEach(async () => {
    vi.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminOrganizationsService,
        { provide: AdminOrganizationsRepository, useValue: mockRepository },
        { provide: ActivityLogService, useValue: mockActivityLog },
        { provide: FeatureFlagsService, useValue: mockFeatureFlags },
        { provide: LegalAuditService, useValue: mockLegalAudit },
        { provide: InviteMemberService, useValue: mockInviteMember },
        { provide: OrgExportService, useValue: mockOrgExport },
        { provide: StorageService, useValue: mockStorageService },
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

    it('returns null for nullable stripe fields when org has no billing data', async () => {
      const orgNoBilling = {
        ...mockOrg,
        stripeCustomerId: null,
        subscriptionId: null,
        subscriptionPeriodEnd: null,
      };
      mockRepository.findByIdWithMemberCount.mockResolvedValue(orgNoBilling);
      mockActivityLog.findByOrg.mockResolvedValue(mockActivity);
      mockFeatureFlags.getEntitlements.mockResolvedValue(mockEntitlements);

      const result = await service.getOrganizationDetail('org-1');

      expect(result.stripeCustomerId).toBeNull();
      expect(result.subscriptionId).toBeNull();
      expect(result.subscriptionPeriodEnd).toBeNull();
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
      expect(mockLegalAudit.recordEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'organization.provisioned',
          orgId: 'org-new',
          triggerType: 'admin_action',
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

  describe('setOrgStatus', () => {
    const suspendedOrg = { ...mockOrg, status: OrganizationStatus.SUSPENDED };

    it('throws NotFoundException when org does not exist', async () => {
      mockRepository.findByIdWithMemberCount.mockResolvedValue(null);

      await expect(
        service.setOrgStatus(
          'missing',
          OrganizationStatus.SUSPENDED,
          undefined,
          'admin-1',
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('suspends org, invalidates cache, and logs activity', async () => {
      mockRepository.findByIdWithMemberCount.mockResolvedValue(mockOrg);
      mockRepository.updateStatus.mockResolvedValue(suspendedOrg);
      mockFeatureFlags.invalidateEntitlements.mockResolvedValue(undefined);

      const result = await service.setOrgStatus(
        'org-1',
        OrganizationStatus.SUSPENDED,
        'Policy violation',
        'admin-1',
      );

      expect(mockRepository.updateStatus).toHaveBeenCalledWith(
        'org-1',
        OrganizationStatus.SUSPENDED,
      );
      expect(mockFeatureFlags.invalidateEntitlements).toHaveBeenCalledWith(
        'org-1',
      );
      expect(mockActivityLog.logActivity).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'organization.suspended',
          orgId: 'org-1',
          metadata: expect.objectContaining({
            status: OrganizationStatus.SUSPENDED,
            reason: 'Policy violation',
          }),
        }),
      );
      expect(mockLegalAudit.recordEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'organization.suspended',
          orgId: 'org-1',
          triggerType: 'admin_action',
          metadata: expect.objectContaining({
            status: OrganizationStatus.SUSPENDED,
            reason: 'Policy violation',
          }),
        }),
      );
      expect(result.status).toBe(OrganizationStatus.SUSPENDED);
    });

    it('reactivates org, invalidates cache, and logs reactivated action', async () => {
      const reactivatedOrg = { ...mockOrg, status: OrganizationStatus.ACTIVE };
      mockRepository.findByIdWithMemberCount.mockResolvedValue(suspendedOrg);
      mockRepository.updateStatus.mockResolvedValue(reactivatedOrg);
      mockFeatureFlags.invalidateEntitlements.mockResolvedValue(undefined);

      await service.setOrgStatus(
        'org-1',
        OrganizationStatus.ACTIVE,
        undefined,
        'admin-1',
      );

      expect(mockActivityLog.logActivity).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'organization.reactivated' }),
      );
    });

    it('stores null reason when reason is not provided', async () => {
      mockRepository.findByIdWithMemberCount.mockResolvedValue(mockOrg);
      mockRepository.updateStatus.mockResolvedValue(suspendedOrg);
      mockFeatureFlags.invalidateEntitlements.mockResolvedValue(undefined);

      await service.setOrgStatus(
        'org-1',
        OrganizationStatus.SUSPENDED,
        undefined,
        'admin-1',
      );

      expect(mockActivityLog.logActivity).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({ reason: null }),
        }),
      );
    });
  });

  describe('requestExport', () => {
    it('delegates to OrgExportService and returns { exportId }', async () => {
      mockOrgExport.requestExport.mockResolvedValue('export-uuid');

      const result = await service.requestExport('org-1', 'admin-1');

      expect(mockOrgExport.requestExport).toHaveBeenCalledWith(
        'org-1',
        'admin-1',
      );
      expect(result).toEqual({ exportId: 'export-uuid' });
    });

    it('propagates errors from OrgExportService', async () => {
      mockOrgExport.requestExport.mockRejectedValue(
        new NotFoundException('Organization org-1 not found'),
      );

      await expect(service.requestExport('org-1', 'admin-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('listExports', () => {
    it('delegates to OrgExportService and returns paginated result', async () => {
      const mockRecord = {
        id: 'export-1',
        orgId: 'org-1',
        status: 'PENDING',
        fileSize: null,
      };
      mockOrgExport.listExports.mockResolvedValue([mockRecord]);
      mockOrgExport.countExports.mockResolvedValue(1);

      const result = await service.listExports('org-1', 10, 0);

      expect(mockOrgExport.listExports).toHaveBeenCalledWith('org-1', 10, 0);
      expect(mockOrgExport.countExports).toHaveBeenCalledWith('org-1');
      expect(result).toEqual({
        items: [{ ...mockRecord, fileSize: null }],
        total: 1,
        limit: 10,
        offset: 0,
      });
    });
  });

  describe('getExport', () => {
    it('delegates to OrgExportService', async () => {
      const mockExport = {
        id: 'export-1',
        orgId: 'org-1',
        status: 'PENDING',
        fileSize: BigInt(1024),
      };
      mockOrgExport.getExport.mockResolvedValue(mockExport);

      const result = await service.getExport('export-1', 'org-1');

      expect(mockOrgExport.getExport).toHaveBeenCalledWith('export-1', 'org-1');
      expect(result).toEqual({ ...mockExport, fileSize: '1024' });
    });

    it('propagates NotFoundException from OrgExportService', async () => {
      mockOrgExport.getExport.mockRejectedValue(
        new NotFoundException(
          'Export export-1 not found for organization org-1',
        ),
      );

      await expect(service.getExport('export-1', 'org-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('getStorageStats', () => {
    it('delegates to StorageService and returns the result', async () => {
      const stats = { totalBytes: '10485760', fileCount: 5 };
      mockStorageService.getStorageStats.mockResolvedValue(stats);

      const result = await service.getStorageStats('org-1');

      expect(mockStorageService.getStorageStats).toHaveBeenCalledWith('org-1');
      expect(result).toEqual(stats);
    });
  });
});
