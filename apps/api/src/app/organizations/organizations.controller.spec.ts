import { RequestUser } from '@libs/common';
import { DeletionTrigger, OrgDeletionService } from '@libs/org-deletion';
import { NotFoundException } from '@nestjs/common';
import { AuthService } from '../auth/auth.service';
import { OrganizationsController } from './organizations.controller';
import { OrganizationsService } from '@libs/organizations';
import { OrgExportService } from '@libs/org-export';

const mockOrganizationsService = {
  createOrganization: jest.fn(),
  findByUserId: jest.fn(),
  findById: jest.fn(),
  updateOrganization: jest.fn(),
} as unknown as OrganizationsService;

const mockAuthService = {
  findUserByAuth0Id: jest.fn(),
} as unknown as AuthService;

const mockOrgDeletionService = {
  scheduleOrgDeletion: jest.fn(),
  requestDeletion: jest.fn(),
} as unknown as OrgDeletionService;

const mockOrgExportService = {
  requestExport: jest.fn(),
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
    jest.clearAllMocks();
    controller = new OrganizationsController(
      mockOrganizationsService,
      mockAuthService,
      mockOrgDeletionService,
      mockOrgExportService,
    );
  });

  // ---------- Helper ---------------------------------------------------------
  function setupDbUser(user = dbUser) {
    mockAuthService.findUserByAuth0Id = jest.fn().mockResolvedValue(user);
  }

  // ---------- create ---------------------------------------------------------
  describe('create()', () => {
    it('creates an organization for the current user', async () => {
      setupDbUser();
      mockOrganizationsService.createOrganization = jest
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
      mockAuthService.findUserByAuth0Id = jest.fn().mockResolvedValue(null);

      await expect(
        controller.create(jwtUser, { name: 'Acme' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('propagates BadRequestException from service (e.g. tx failure)', async () => {
      setupDbUser();
      const { BadRequestException } = jest.requireActual('@nestjs/common');
      mockOrganizationsService.createOrganization = jest
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
      mockOrganizationsService.findByUserId = jest.fn().mockResolvedValue(orgs);

      const result = await controller.findMine(jwtUser);
      expect(result).toBe(orgs);
      expect(mockOrganizationsService.findByUserId).toHaveBeenCalledWith(
        'db-u-1',
      );
    });

    it('returns an empty array when user has no orgs', async () => {
      setupDbUser();
      mockOrganizationsService.findByUserId = jest.fn().mockResolvedValue([]);

      expect(await controller.findMine(jwtUser)).toEqual([]);
    });

    it('throws NotFoundException when user is not found in DB', async () => {
      mockAuthService.findUserByAuth0Id = jest.fn().mockResolvedValue(null);
      await expect(controller.findMine(jwtUser)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ---------- findOne --------------------------------------------------------
  describe('findOne()', () => {
    it('returns the org by id', async () => {
      mockOrganizationsService.findById = jest.fn().mockResolvedValue(baseOrg);

      expect(await controller.findOne('org-1')).toBe(baseOrg);
    });

    it('propagates NotFoundException when org not found', async () => {
      mockOrganizationsService.findById = jest
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
      mockOrganizationsService.updateOrganization = jest
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
      mockOrganizationsService.updateOrganization = jest
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
      (mockOrgDeletionService.requestDeletion as jest.Mock).mockResolvedValue(
        undefined,
      );
      mockOrganizationsService.findById = jest
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
      mockAuthService.findUserByAuth0Id = jest.fn().mockResolvedValue(null);

      await expect(
        controller.requestDeletion(jwtUser, 'org-1'),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
