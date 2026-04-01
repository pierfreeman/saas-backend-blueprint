import { OrganizationsService } from './organizations.service';
import { OrganizationsRepository } from '../../infrastructure/repositories/organizations.repository';
import { ActivityLogService } from '@libs/activity-log';
import { LegalAuditService } from '@libs/legal-audit';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { vi } from 'vitest';

const mockActivityLog = {
  logActivity: vi.fn(),
} as unknown as ActivityLogService;
const mockLegalAudit = {
  recordEvent: vi.fn(),
} as unknown as LegalAuditService;

const mockTx = {
  organization: { create: vi.fn() },
  membership: { create: vi.fn() },
};

const mockRepo = {
  createWithOwner: vi.fn(),
  findById: vi.fn(),
  findByUserId: vi.fn(),
  update: vi.fn(),
  deleteJobs: vi.fn(),
  delete: vi.fn(),
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
    vi.clearAllMocks();
    service = new OrganizationsService(
      mockRepo,
      mockActivityLog,
      mockLegalAudit,
    );
  });

  describe('createOrganization', () => {
    it('creates org and assigns OWNER membership via repository', async () => {
      mockRepo.createWithOwner = vi.fn().mockResolvedValue(baseOrg);

      const result = await service.createOrganization('u-1', { name: 'Acme' });

      expect(result).toBe(baseOrg);
      expect(mockRepo.createWithOwner).toHaveBeenCalledWith('Acme', 'u-1');
    });

    it('fires logActivity and recordEvent after successful creation', async () => {
      mockRepo.createWithOwner = vi.fn().mockResolvedValue(baseOrg);

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
      mockRepo.createWithOwner = vi
        .fn()
        .mockRejectedValue(new Error('DB error'));
      await expect(
        service.createOrganization('u-1', { name: 'Acme' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when a non-Error is thrown', async () => {
      mockRepo.createWithOwner = vi.fn().mockRejectedValue('string error');
      await expect(
        service.createOrganization('u-1', { name: 'Acme' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('findById', () => {
    it('returns org when found', async () => {
      mockRepo.findById = vi.fn().mockResolvedValue(baseOrg);
      expect(await service.findById('org-1')).toBe(baseOrg);
    });

    it('throws NotFoundException when not found', async () => {
      mockRepo.findById = vi.fn().mockResolvedValue(null);
      await expect(service.findById('nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('findByUserId', () => {
    it('returns orgs via repository', async () => {
      mockRepo.findByUserId = vi.fn().mockResolvedValue([baseOrg]);
      expect(await service.findByUserId('u-1')).toEqual([baseOrg]);
    });

    it('returns empty array when user has no memberships', async () => {
      mockRepo.findByUserId = vi.fn().mockResolvedValue([]);
      expect(await service.findByUserId('u-none')).toEqual([]);
    });
  });

  describe('updateOrganization', () => {
    it('updates org and fires audit events', async () => {
      const updated = { ...baseOrg, name: 'NewName' };
      mockRepo.findById = vi.fn().mockResolvedValue(baseOrg);
      mockRepo.update = vi.fn().mockResolvedValue(updated);

      const result = await service.updateOrganization('org-1', {
        name: 'NewName',
      });

      expect(result).toBe(updated);
      expect(mockActivityLog.logActivity).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'organization.updated' }),
      );
    });

    it('passes userId through to audit log when provided', async () => {
      const updated = { ...baseOrg, name: 'NewName' };
      mockRepo.findById = vi.fn().mockResolvedValue(baseOrg);
      mockRepo.update = vi.fn().mockResolvedValue(updated);

      await service.updateOrganization('org-1', { name: 'NewName' }, 'u-1');

      expect(mockActivityLog.logActivity).toHaveBeenCalledWith(
        expect.objectContaining({ actorId: 'u-1' }),
      );
      expect(mockLegalAudit.recordEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({ userId: 'u-1' }),
        }),
      );
    });

    it('sets actorId/userId to null when userId is undefined', async () => {
      const updated = { ...baseOrg, name: 'NewName' };
      mockRepo.findById = vi.fn().mockResolvedValue(baseOrg);
      mockRepo.update = vi.fn().mockResolvedValue(updated);

      await service.updateOrganization('org-1', { name: 'NewName' });

      expect(mockActivityLog.logActivity).toHaveBeenCalledWith(
        expect.objectContaining({ actorId: null }),
      );
      expect(mockLegalAudit.recordEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({ userId: null }),
        }),
      );
    });

    it('throws NotFoundException for unknown org', async () => {
      mockRepo.findById = vi.fn().mockResolvedValue(null);
      await expect(
        service.updateOrganization('bad-id', { name: 'X' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('deleteOrganization', () => {
    it('deletes jobs + org, fires activityLog and records legal audit event', async () => {
      mockRepo.findById = vi.fn().mockResolvedValue(baseOrg);
      mockRepo.deleteJobs = vi.fn().mockResolvedValue(undefined);
      mockRepo.delete = vi.fn().mockResolvedValue(undefined);

      await service.deleteOrganization('org-1');

      expect(mockRepo.deleteJobs).toHaveBeenCalledWith('org-1');
      expect(mockRepo.delete).toHaveBeenCalledWith('org-1');
      expect(mockActivityLog.logActivity).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'organization.deleted' }),
      );
      expect(mockLegalAudit.recordEvent).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'organization.deleted' }),
      );
    });

    it('passes userId to legal audit metadata when provided', async () => {
      mockRepo.findById = vi.fn().mockResolvedValue(baseOrg);
      mockRepo.deleteJobs = vi.fn().mockResolvedValue(undefined);
      mockRepo.delete = vi.fn().mockResolvedValue(undefined);

      await service.deleteOrganization('org-1', 'u-1');

      expect(mockLegalAudit.recordEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({ userId: 'u-1' }),
        }),
      );
    });

    it('sets userId to null in metadata when not provided', async () => {
      mockRepo.findById = vi.fn().mockResolvedValue(baseOrg);
      mockRepo.deleteJobs = vi.fn().mockResolvedValue(undefined);
      mockRepo.delete = vi.fn().mockResolvedValue(undefined);

      await service.deleteOrganization('org-1');

      expect(mockLegalAudit.recordEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({ userId: null }),
        }),
      );
    });

    it('throws NotFoundException for unknown org', async () => {
      mockRepo.findById = vi.fn().mockResolvedValue(null);
      await expect(service.deleteOrganization('bad-id')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
