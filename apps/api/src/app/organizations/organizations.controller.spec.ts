import { OrganizationsController } from './organizations.controller';
import { OrganizationsService } from './organizations.service';
import { AuthService } from '../auth/auth.service';
import { NotFoundException } from '@nestjs/common';
import { RequestUser } from '@libs/common';

const mockOrganizationsService = {
  createOrganization: jest.fn(),
  findByUserId: jest.fn(),
  findById: jest.fn(),
  updateOrganization: jest.fn(),
  deleteOrganization: jest.fn(),
} as unknown as OrganizationsService;

const mockAuthService = {
  findUserByAuth0Id: jest.fn(),
} as unknown as AuthService;

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
      const updated = { ...baseOrg, name: 'New Name' };
      mockOrganizationsService.updateOrganization = jest
        .fn()
        .mockResolvedValue(updated);

      const result = await controller.update('org-1', { name: 'New Name' });
      expect(result).toBe(updated);
      expect(mockOrganizationsService.updateOrganization).toHaveBeenCalledWith(
        'org-1',
        { name: 'New Name' },
      );
    });

    it('propagates NotFoundException from service', async () => {
      mockOrganizationsService.updateOrganization = jest
        .fn()
        .mockRejectedValue(
          new NotFoundException('Organization bad-id not found'),
        );

      await expect(controller.update('bad-id', { name: 'X' })).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ---------- delete ---------------------------------------------------------
  describe('delete()', () => {
    it('deletes an organization and returns a success message', async () => {
      mockOrganizationsService.deleteOrganization = jest
        .fn()
        .mockResolvedValue(undefined);

      const result = await controller.delete('org-1');
      expect(result).toEqual({ message: 'Organization deleted successfully' });
      expect(mockOrganizationsService.deleteOrganization).toHaveBeenCalledWith(
        'org-1',
      );
    });

    it('propagates NotFoundException when org not found', async () => {
      mockOrganizationsService.deleteOrganization = jest
        .fn()
        .mockRejectedValue(
          new NotFoundException('Organization bad-id not found'),
        );

      await expect(controller.delete('bad-id')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
