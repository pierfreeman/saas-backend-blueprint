import { OrganizationsService } from './organizations.service';
import { PrismaBusinessService } from '@libs/prisma-business';
import { ActivityLogService } from '@libs/activity-log';
import { LegalAuditService } from '@libs/legal-audit';
import { BadRequestException, NotFoundException } from '@nestjs/common';

const mockActivityLogService = {
  logActivity: jest.fn(),
} as unknown as ActivityLogService;

const mockLegalAuditService = {
  recordEvent: jest.fn(),
} as unknown as LegalAuditService;

const mockTx = {
  organization: { create: jest.fn() },
  membership: { create: jest.fn() },
};

const mockPrisma = {
  organization: {
    create: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
  membership: { findMany: jest.fn() },
  job: { deleteMany: jest.fn() },
  $transaction: jest.fn(),
} as unknown as PrismaBusinessService;

const baseOrg = {
  id: 'org-1',
  name: 'Acme',
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('OrganizationsService', () => {
  let service: OrganizationsService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new OrganizationsService(
      mockPrisma,
      mockActivityLogService,
      mockLegalAuditService,
    );
  });

  describe('createOrganization', () => {
    it('creates org and assigns OWNER membership in a transaction', async () => {
      mockTx.organization.create.mockResolvedValue(baseOrg);
      mockTx.membership.create.mockResolvedValue({});
      mockPrisma.$transaction = jest
        .fn()
        .mockImplementation((fn: (tx: typeof mockTx) => Promise<unknown>) =>
          fn(mockTx),
        );

      const result = await service.createOrganization('u-1', { name: 'Acme' });

      expect(result).toBe(baseOrg);
      expect(mockTx.organization.create).toHaveBeenCalledWith({
        data: { name: 'Acme' },
      });
      expect(mockTx.membership.create).toHaveBeenCalledWith({
        data: { userId: 'u-1', orgId: 'org-1', role: 'OWNER' },
      });
    });

    it('fires logActivity and recordEvent after successful creation', async () => {
      mockTx.organization.create.mockResolvedValue(baseOrg);
      mockTx.membership.create.mockResolvedValue({});
      mockPrisma.$transaction = jest
        .fn()
        .mockImplementation((fn: (tx: typeof mockTx) => Promise<unknown>) =>
          fn(mockTx),
        );

      await service.createOrganization('u-1', { name: 'Acme' });

      expect(mockActivityLogService.logActivity).toHaveBeenCalledWith(
        expect.objectContaining({
          orgId: 'org-1',
          action: 'organization.created',
        }),
      );
      expect(mockLegalAuditService.recordEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'organization.created',
          orgId: 'org-1',
        }),
      );
    });

    it('throws BadRequestException when transaction fails', async () => {
      mockPrisma.$transaction = jest
        .fn()
        .mockRejectedValue(new Error('DB error'));
      await expect(
        service.createOrganization('u-1', { name: 'Acme' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('findById', () => {
    it('returns org when found', async () => {
      mockPrisma.organization.findUnique = jest.fn().mockResolvedValue(baseOrg);
      expect(await service.findById('org-1')).toBe(baseOrg);
    });

    it('throws NotFoundException when not found', async () => {
      mockPrisma.organization.findUnique = jest.fn().mockResolvedValue(null);
      await expect(service.findById('nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('findByUserId', () => {
    it('returns orgs from membership list', async () => {
      mockPrisma.membership.findMany = jest
        .fn()
        .mockResolvedValue([
          { organization: baseOrg },
          { organization: { ...baseOrg, id: 'org-2' } },
        ]);
      const result = await service.findByUserId('u-1');
      expect(result).toHaveLength(2);
      expect(result[0]).toBe(baseOrg);
    });

    it('returns an empty array when user has no memberships', async () => {
      mockPrisma.membership.findMany = jest.fn().mockResolvedValue([]);
      const result = await service.findByUserId('u-no-orgs');
      expect(result).toEqual([]);
    });
  });

  describe('updateOrganization', () => {
    it('updates org and returns updated entity', async () => {
      const updated = { ...baseOrg, name: 'NewName' };
      mockPrisma.organization.findUnique = jest.fn().mockResolvedValue(baseOrg);
      mockPrisma.organization.update = jest.fn().mockResolvedValue(updated);

      const result = await service.updateOrganization('org-1', {
        name: 'NewName',
      });
      expect(result).toBe(updated);
    });

    it('throws NotFoundException for unknown org', async () => {
      mockPrisma.organization.findUnique = jest.fn().mockResolvedValue(null);
      await expect(
        service.updateOrganization('bad-id', { name: 'X' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('deleteOrganization', () => {
    it('deletes the org and records legal audit event', async () => {
      mockPrisma.organization.findUnique = jest.fn().mockResolvedValue(baseOrg);
      mockPrisma.organization.delete = jest.fn().mockResolvedValue(undefined);
      mockPrisma.job.deleteMany = jest.fn().mockResolvedValue({ count: 0 });
      await service.deleteOrganization('org-1');
      expect(mockPrisma.organization.delete).toHaveBeenCalledWith({
        where: { id: 'org-1' },
      });
      expect(mockLegalAuditService.recordEvent).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'organization.deleted' }),
      );
    });

    it('throws NotFoundException for unknown org', async () => {
      mockPrisma.organization.findUnique = jest.fn().mockResolvedValue(null);
      await expect(service.deleteOrganization('bad-id')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
