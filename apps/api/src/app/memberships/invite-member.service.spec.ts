import { ConflictException, NotFoundException } from '@nestjs/common';
import { MembershipRole, MembershipStatus } from '@prisma/client';
import { InviteMemberService } from './invite-member.service';
import { PENDING_AUTH0_ID_PREFIX } from '../auth/auth.service';

const baseMembership = {
  id: 'm-1',
  userId: 'u-1',
  orgId: 'org-1',
  role: 'MEMBER' as MembershipRole,
  status: 'INVITED' as MembershipStatus,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const baseOrg = { id: 'org-1', name: 'Acme Corp' };
const inviterUser = {
  id: 'inviter-1',
  email: 'boss@example.com',
  auth0Id: 'auth0|boss',
};
const existingUser = {
  id: 'u-existing',
  email: 'alice@example.com',
  auth0Id: 'auth0|existing',
};
const pendingUser = {
  id: 'u-new',
  email: 'newbie@example.com',
  auth0Id: `${PENDING_AUTH0_ID_PREFIX}some-uuid`,
};

const mockUsersService = {
  findById: jest.fn(),
  findByEmail: jest.fn(),
  createUser: jest.fn(),
};

const mockMembershipsService = {
  findByUserAndOrg: jest.fn(),
  createMembership: jest.fn(),
};

const mockOrganizationsService = {
  findById: jest.fn(),
};

const mockAuth0ManagementService = {
  sendPasswordlessLink: jest.fn(),
};

const mockConfigService = {
  get: jest.fn().mockReturnValue('http://localhost:4200'),
};

function buildService() {
  return new InviteMemberService(
    mockUsersService as never,
    mockMembershipsService as never,
    mockOrganizationsService as never,
    mockAuth0ManagementService as never,
    mockConfigService as never,
  );
}

describe('InviteMemberService', () => {
  let service: InviteMemberService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = buildService();

    // Default happy-path returns
    mockOrganizationsService.findById.mockResolvedValue(baseOrg);
    mockUsersService.findById.mockResolvedValue(inviterUser);
    mockMembershipsService.findByUserAndOrg.mockResolvedValue(null);
    mockMembershipsService.createMembership.mockResolvedValue(baseMembership);
    mockAuth0ManagementService.sendPasswordlessLink.mockResolvedValue(
      undefined,
    );
  });

  describe('invite — existing user', () => {
    it('creates membership and sends Auth0 passwordless link without creating a new Prisma user', async () => {
      mockUsersService.findByEmail.mockResolvedValue(existingUser);

      const result = await service.invite(
        { email: existingUser.email, role: MembershipRole.MEMBER },
        'org-1',
        inviterUser.id,
      );

      expect(result).toEqual({ message: 'Invitation sent successfully.' });
      expect(mockUsersService.createUser).not.toHaveBeenCalled();
      expect(mockMembershipsService.createMembership).toHaveBeenCalledWith(
        'org-1',
        { userId: existingUser.id, role: MembershipRole.MEMBER },
        inviterUser.id,
      );
      expect(
        mockAuth0ManagementService.sendPasswordlessLink,
      ).toHaveBeenCalledWith(
        existingUser.email,
        'http://localhost:4200/auth/callback',
      );
    });
  });

  describe('invite — new user (not in Prisma)', () => {
    it('creates a pending Prisma user, creates membership, and sends Auth0 passwordless link', async () => {
      mockUsersService.findByEmail.mockResolvedValue(null);
      mockUsersService.createUser.mockResolvedValue(pendingUser);

      const result = await service.invite(
        { email: pendingUser.email, role: MembershipRole.MEMBER },
        'org-1',
        inviterUser.id,
      );

      expect(result).toEqual({ message: 'Invitation sent successfully.' });

      // Must create a pending Prisma record (no Auth0 pre-creation)
      expect(mockUsersService.createUser).toHaveBeenCalledWith(
        expect.stringMatching(new RegExp(`^${PENDING_AUTH0_ID_PREFIX}`)),
        pendingUser.email,
      );

      // Membership created for the pending user
      expect(mockMembershipsService.createMembership).toHaveBeenCalledWith(
        'org-1',
        { userId: pendingUser.id, role: MembershipRole.MEMBER },
        inviterUser.id,
      );

      // Auth0 passwordless link sent with correct redirect URI
      expect(
        mockAuth0ManagementService.sendPasswordlessLink,
      ).toHaveBeenCalledWith(
        pendingUser.email,
        'http://localhost:4200/auth/callback',
      );
    });
  });

  describe('invite — duplicate membership guard', () => {
    it('throws ConflictException when the user is already a member', async () => {
      mockUsersService.findByEmail.mockResolvedValue(existingUser);
      mockMembershipsService.findByUserAndOrg.mockResolvedValue(baseMembership);

      await expect(
        service.invite(
          { email: existingUser.email, role: MembershipRole.MEMBER },
          'org-1',
          inviterUser.id,
        ),
      ).rejects.toThrow(ConflictException);

      expect(mockMembershipsService.createMembership).not.toHaveBeenCalled();
    });
  });

  describe('invite — org not found', () => {
    it('throws NotFoundException when org does not exist', async () => {
      mockOrganizationsService.findById.mockRejectedValue(
        new NotFoundException('Organization org-missing not found.'),
      );
      mockUsersService.findByEmail.mockResolvedValue(existingUser);

      await expect(
        service.invite(
          { email: existingUser.email, role: MembershipRole.MEMBER },
          'org-missing',
          inviterUser.id,
        ),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('invite — email normalization', () => {
    it('normalizes email to lowercase before lookup and when creating a pending user', async () => {
      mockUsersService.findByEmail.mockResolvedValue(null);
      mockUsersService.createUser.mockResolvedValue(pendingUser);

      await service.invite(
        { email: 'NEWBIE@EXAMPLE.COM', role: MembershipRole.MEMBER },
        'org-1',
        inviterUser.id,
      );

      // Lookup must use the normalized address
      expect(mockUsersService.findByEmail).toHaveBeenCalledWith(
        'newbie@example.com',
      );
      // Pending user must be stored with normalized address
      expect(mockUsersService.createUser).toHaveBeenCalledWith(
        expect.stringMatching(new RegExp(`^${PENDING_AUTH0_ID_PREFIX}`)),
        'newbie@example.com',
      );
    });
  });
});
