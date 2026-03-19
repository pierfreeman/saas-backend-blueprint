import { OrganizationsService } from './organizations.service';
import { OrganizationsRepository } from '../../infrastructure/repositories/organizations.repository';
import { ActivityLogService } from '@libs/activity-log';
import { LegalAuditService } from '@libs/legal-audit';
import { BadRequestException, NotFoundException } from '@nestjs/common';

const mockActivityLog = {
  logActivity: jest.fn(),
} as unknown as ActivityLogService;
const mockLegalAudit = {
  recordEvent: jest.fn(),
} as unknown as LegalAuditService;

const mockTx = {
  organization: { create: jest.fn() },
  membership: { create: jest.fn() },
};

const mockRepo = {
  createWithOwner: jest.fn(),
  findById: jest.fn(),
  findByUserId: jest.fn(),
  update: jest.fn(),
  deleteJobs: jest.fn(),
  delete: jest.fn(),
} as unknown as OrganizationsRepository;

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
      mockRepo,
      mockActivityLog,
      mockLegalAudit,
    );
  });

  describe('createOrganization', () => {
    it('creates org and assigns OWNER membership via repository', async () => {
      mockRepo.createWithOwner = jest.fn().mockResolvedValue(baseOrg);

      const result = await service.createOrganization('u-1', { name: 'Acme' });

      expect(result).toBe(baseOrg);
      expect(mockRepo.createWithOwner).toHaveBeenCalledWith('Acme', 'u-1');
    });

    it('fires logActivity and recordEvent after successful creation', async () => {
      mockRepo.createWithOwner = jest.fn().mockResolvedValue(baseOrg);

      await service.createOrganization('u-1', { name: 'Acme' });

      expect(mockActivityLog.logActivity).toHaveBeenCalledWith(
        expect.objectContaining({
          orgId: 'org-1',
          action: 'organization.created',
        }),
      );
      expect(mockLegalAudit.recordEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'organization.created',
          orgId: 'org-1',
        }),
      );
    });

    it('throws BadRequestException when repository throws', async () => {
      mockRepo.createWithOwner = jest
        .fn()
        .mockRejectedValue(new Error('DB error'));
      await expect(
        service.createOrganization('u-1', { name: 'Acme' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('findById', () => {
    it('returns org when found', async () => {
      mockRepo.findById = jest.fn().mockResolvedValue(baseOrg);
      expect(await service.findById('org-1')).toBe(baseOrg);
    });

    it('throws NotFoundException when not found', async () => {
      mockRepo.findById = jest.fn().mockResolvedValue(null);
      await expect(service.findById('nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('findByUserId', () => {
    it('returns orgs via repository', async () => {
      mockRepo.findByUserId = jest.fn().mockResolvedValue([baseOrg]);
      expect(await service.findByUserId('u-1')).toEqual([baseOrg]);
    });

    it('returns empty array when user has no memberships', async () => {
      mockRepo.findByUserId = jest.fn().mockResolvedValue([]);
      expect(await service.findByUserId('u-none')).toEqual([]);
    });
  });

  describe('updateOrganization', () => {
    it('updates org and fires audit events', async () => {
      const updated = { ...baseOrg, name: 'NewName' };
      mockRepo.findById = jest.fn().mockResolvedValue(baseOrg);
      mockRepo.update = jest.fn().mockResolvedValue(updated);

      const result = await service.updateOrganization('org-1', {
        name: 'NewName',
      });

      expect(result).toBe(updated);
      expect(mockActivityLog.logActivity).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'organization.updated' }),
      );
    });

    it('throws NotFoundException for unknown org', async () => {
      mockRepo.findById = jest.fn().mockResolvedValue(null);
      await expect(
        service.updateOrganization('bad-id', { name: 'X' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('deleteOrganization', () => {
    it('deletes jobs + org and records legal audit event', async () => {
      mockRepo.findById = jest.fn().mockResolvedValue(baseOrg);
      mockRepo.deleteJobs = jest.fn().mockResolvedValue(undefined);
      mockRepo.delete = jest.fn().mockResolvedValue(undefined);

      await service.deleteOrganization('org-1');

      expect(mockRepo.deleteJobs).toHaveBeenCalledWith('org-1');
      expect(mockRepo.delete).toHaveBeenCalledWith('org-1');
      expect(mockLegalAudit.recordEvent).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'organization.deleted' }),
      );
    });

    it('throws NotFoundException for unknown org', async () => {
      mockRepo.findById = jest.fn().mockResolvedValue(null);
      await expect(service.deleteOrganization('bad-id')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
