import { RequestUser } from '@libs/common';
import { DeletionTrigger, OrgDeletionService } from '@libs/org-deletion';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AuthService } from '@libs/auth0';
import { OrganizationsController } from './organizations.controller';
import { OrganizationsService } from '@libs/organizations';
import { OrgExportService } from '@libs/org-export';
import { Mock, vi } from 'vitest';

const mockOrganizationsService = {
  createOrganization: vi.fn(),
  findByUserId: vi.fn(),
  findById: vi.fn(),
  updateOrganization: vi.fn(),
} as unknown as OrganizationsService;

const mockAuthService = {
  findUserByAuth0Id: vi.fn(),
} as unknown as AuthService;

const mockOrgDeletionService = {
  scheduleOrgDeletion: vi.fn(),
  requestDeletion: vi.fn(),
} as unknown as OrgDeletionService;

const mockOrgExportService = {
  requestExport: vi.fn(),
  getExport: vi.fn(),
  listExports: vi.fn(),
} as unknown as OrgExportService;

const jwtUser: RequestUser = { sub: 'auth0|u1', email: 'user@example.com' };
const dbUser = { id: 'db-u-1', auth0Id: 'auth0|u1', email: 'user@example.com' };
const baseOrg = {
  id: 'org-1',
  name: 'Acme',
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('OrganizationsController', () => {
  let controller: OrganizationsController;

  beforeEach(() => {
    vi.clearAllMocks();
    controller = new OrganizationsController(
      mockOrganizationsService,
      mockAuthService,
      mockOrgDeletionService,
      mockOrgExportService,
    );
  });

  // ---------- Helper ---------------------------------------------------------
  function setupDbUser(user = dbUser) {
    mockAuthService.findUserByAuth0Id = vi.fn().mockResolvedValue(user);
  }

  // ---------- create ---------------------------------------------------------
  describe('create()', () => {
    it('creates an organization for the current user', async () => {
      setupDbUser();
      mockOrganizationsService.createOrganization = vi
        .fn()
        .mockResolvedValue(baseOrg);

      const result = await controller.create(jwtUser, { name: 'Acme' });

      expect(result).toBe(baseOrg);
      expect(mockAuthService.findUserByAuth0Id).toHaveBeenCalledWith(
        'auth0|u1',
      );
      expect(mockOrganizationsService.createOrganization).toHaveBeenCalledWith(
        'db-u-1',
        { name: 'Acme' },
      );
    });

    it('throws NotFoundException when user is not found in DB', async () => {
      mockAuthService.findUserByAuth0Id = vi.fn().mockResolvedValue(null);

      await expect(
        controller.create(jwtUser, { name: 'Acme' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('propagates BadRequestException from service (e.g. tx failure)', async () => {
      setupDbUser();
      mockOrganizationsService.createOrganization = vi
        .fn()
        .mockRejectedValue(
          new BadRequestException('Failed to create organization'),
        );

      await expect(
        controller.create(jwtUser, { name: 'Acme' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ---------- findMine -------------------------------------------------------
  describe('findMine()', () => {
    it('returns all orgs belonging to the current user', async () => {
      setupDbUser();
      const orgs = [baseOrg, { ...baseOrg, id: 'org-2' }];
      mockOrganizationsService.findByUserId = vi.fn().mockResolvedValue(orgs);

      const result = await controller.findMine(jwtUser);
      expect(result).toBe(orgs);
      expect(mockOrganizationsService.findByUserId).toHaveBeenCalledWith(
        'db-u-1',
      );
    });

    it('returns an empty array when user has no orgs', async () => {
      setupDbUser();
      mockOrganizationsService.findByUserId = vi.fn().mockResolvedValue([]);

      expect(await controller.findMine(jwtUser)).toEqual([]);
    });

    it('throws NotFoundException when user is not found in DB', async () => {
      mockAuthService.findUserByAuth0Id = vi.fn().mockResolvedValue(null);
      await expect(controller.findMine(jwtUser)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ---------- findOne --------------------------------------------------------
  describe('findOne()', () => {
    it('returns the org by id', async () => {
      mockOrganizationsService.findById = vi.fn().mockResolvedValue(baseOrg);

      expect(await controller.findOne('org-1')).toBe(baseOrg);
    });

    it('propagates NotFoundException when org not found', async () => {
      mockOrganizationsService.findById = vi
        .fn()
        .mockRejectedValue(
          new NotFoundException('Organization org-x not found'),
        );

      await expect(controller.findOne('org-x')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ---------- update ---------------------------------------------------------
  describe('update()', () => {
    it('updates an organization and returns the updated entity', async () => {
      setupDbUser();
      const updated = { ...baseOrg, name: 'New Name' };
      mockOrganizationsService.updateOrganization = vi
        .fn()
        .mockResolvedValue(updated);

      const result = await controller.update(jwtUser, 'org-1', {
        name: 'New Name',
      });
      expect(result).toBe(updated);
      expect(mockOrganizationsService.updateOrganization).toHaveBeenCalledWith(
        'org-1',
        { name: 'New Name' },
        'db-u-1',
      );
    });

    it('propagates NotFoundException from service', async () => {
      setupDbUser();
      mockOrganizationsService.updateOrganization = vi
        .fn()
        .mockRejectedValue(
          new NotFoundException('Organization bad-id not found'),
        );

      await expect(
        controller.update(jwtUser, 'bad-id', { name: 'X' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ---------- requestDeletion ------------------------------------------------
  describe('requestDeletion()', () => {
    it('calls orgDeletionService.requestDeletion and returns scheduledAt', async () => {
      setupDbUser();
      const scheduledAt = new Date('2026-04-17T00:00:00.000Z');
      const orgWithDeletion = { ...baseOrg, deletionScheduledAt: scheduledAt };
      (mockOrgDeletionService.requestDeletion as Mock).mockResolvedValue(
        undefined,
      );
      mockOrganizationsService.findById = vi
        .fn()
        .mockResolvedValue(orgWithDeletion);

      const result = await controller.requestDeletion(jwtUser, 'org-1');

      expect(result.message).toBe(
        'Organization deletion requested successfully',
      );
      expect(result.scheduledAt).toEqual(scheduledAt);
      expect(mockOrgDeletionService.requestDeletion).toHaveBeenCalledWith(
        'org-1',
        DeletionTrigger.USER_REQUEST,
        'db-u-1',
      );
    });

    it('throws NotFoundException when user is not found in DB', async () => {
      mockAuthService.findUserByAuth0Id = vi.fn().mockResolvedValue(null);

      await expect(
        controller.requestDeletion(jwtUser, 'org-1'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ---------- requestExport -------------------------------------------------
  describe('requestExport()', () => {
    it('calls orgExportService.requestExport and returns exportId and message', async () => {
      setupDbUser();
      (mockOrgExportService.requestExport as Mock).mockResolvedValue(
        'export-uuid-1',
      );

      const result = await controller.requestExport(jwtUser, 'org-1');

      expect(result).toEqual({
        exportId: 'export-uuid-1',
        message: 'Export request accepted',
      });
      expect(mockOrgExportService.requestExport).toHaveBeenCalledWith(
        'org-1',
        'db-u-1',
      );
    });

    it('throws NotFoundException when user is not found in DB', async () => {
      mockAuthService.findUserByAuth0Id = vi.fn().mockResolvedValue(null);

      await expect(controller.requestExport(jwtUser, 'org-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('propagates errors from orgExportService.requestExport', async () => {
      setupDbUser();
      (mockOrgExportService.requestExport as Mock).mockRejectedValue(
        new Error('export failed'),
      );

      await expect(controller.requestExport(jwtUser, 'org-1')).rejects.toThrow(
        'export failed',
      );
    });
  });

  // ---------- getExport -----------------------------------------------------
  describe('getExport()', () => {
    it('returns the export details from orgExportService', async () => {
      const exportDetail = {
        id: 'export-uuid-1',
        status: 'COMPLETED',
        downloadUrl: 'https://s3/file',
      };
      (mockOrgExportService.getExport as Mock).mockResolvedValue(exportDetail);

      const result = await controller.getExport('org-1', 'export-uuid-1');

      expect(result).toBe(exportDetail);
      expect(mockOrgExportService.getExport).toHaveBeenCalledWith(
        'export-uuid-1',
        'org-1',
      );
    });

    it('propagates NotFoundException when export is not found', async () => {
      (mockOrgExportService.getExport as Mock).mockRejectedValue(
        new NotFoundException('Export not found'),
      );

      await expect(
        controller.getExport('org-1', 'missing-export'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ---------- listExports ---------------------------------------------------
  describe('listExports()', () => {
    it('lists exports without pagination params', async () => {
      const exports = [{ id: 'export-uuid-1', status: 'COMPLETED' }];
      (mockOrgExportService.listExports as Mock).mockResolvedValue(exports);

      const result = await controller.listExports('org-1');

      expect(result).toBe(exports);
      expect(mockOrgExportService.listExports).toHaveBeenCalledWith(
        'org-1',
        undefined,
        undefined,
      );
    });

    it('parses limit and offset query params as integers', async () => {
      (mockOrgExportService.listExports as Mock).mockResolvedValue([]);

      await controller.listExports('org-1', '10', '20');

      expect(mockOrgExportService.listExports).toHaveBeenCalledWith(
        'org-1',
        10,
        20,
      );
    });

    it('passes undefined for limit when not provided, but parses offset', async () => {
      (mockOrgExportService.listExports as Mock).mockResolvedValue([]);

      await controller.listExports('org-1', undefined, '5');

      expect(mockOrgExportService.listExports).toHaveBeenCalledWith(
        'org-1',
        undefined,
        5,
      );
    });
  });
});
