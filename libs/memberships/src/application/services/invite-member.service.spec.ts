import { ConflictException, NotFoundException } from '@nestjs/common';
import { MembershipRole, MembershipStatus } from '@libs/prisma-business';
import { InviteMemberService } from './invite-member.service';
import { PENDING_USER_PREFIX } from '@libs/common';
import { vi } from 'vitest';

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
  auth0Id: `${PENDING_USER_PREFIX}some-uuid`,
};

const mockUsersService = {
  findById: vi.fn(),
  findByEmail: vi.fn(),
  createUser: vi.fn(),
};

const mockMembershipsService = {
  findByUserAndOrg: vi.fn(),
  createMembership: vi.fn(),
};

const mockOrganizationsService = {
  findById: vi.fn(),
};

const mockIdentityProvider = {
  sendInviteLink: vi.fn(),
};

const mockConfigService = {
  get: vi.fn().mockReturnValue('http://localhost:4200'),
};

const mockEventBus = {
  publish: vi.fn().mockResolvedValue(undefined),
};

const mockActivityLog = {
  logActivity: vi.fn(),
};

const mockLegalAudit = {
  recordEvent: vi.fn(),
};

function buildService() {
  return new InviteMemberService(
    mockUsersService as never,
    mockMembershipsService as never,
    mockOrganizationsService as never,
    mockIdentityProvider as never,
    mockConfigService as never,
    mockEventBus as never,
    mockActivityLog as never,
    mockLegalAudit as never,
  );
}

describe('InviteMemberService', () => {
  let service: InviteMemberService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = buildService();

    // Default happy-path returns
    mockOrganizationsService.findById.mockResolvedValue(baseOrg);
    mockUsersService.findById.mockResolvedValue(inviterUser);
    mockMembershipsService.findByUserAndOrg.mockResolvedValue(null);
    mockMembershipsService.createMembership.mockResolvedValue(baseMembership);
    mockIdentityProvider.sendInviteLink.mockResolvedValue(undefined);
  });

  describe('invite — existing user (database / auth0| connection)', () => {
    it('creates membership and sends passwordless link', async () => {
      mockUsersService.findByEmail.mockResolvedValue(existingUser);

      const result = await service.invite(
        existingUser.email,
        MembershipRole.MEMBER,
        'org-1',
        inviterUser.id,
      );

      expect(result).toEqual({ message: 'Invitation sent successfully.' });
      expect(mockUsersService.createUser).not.toHaveBeenCalled();
      expect(mockMembershipsService.createMembership).toHaveBeenCalledWith(
        'org-1',
        {
          userId: existingUser.id,
          role: MembershipRole.MEMBER,
          status: 'ACTIVE',
        },
        inviterUser.id,
        'user_action',
      );
      // auth0| users can receive a passwordless link
      expect(mockIdentityProvider.sendInviteLink).toHaveBeenCalledWith(
        existingUser.email,
        'http://localhost:4200/auth/callback',
      );

      // USER_INVITED event published
      expect(mockEventBus.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'user.invited',
          tenantId: 'org-1',
          payload: expect.objectContaining({
            inviteeEmail: existingUser.email,
            organizationName: 'Acme Corp',
            role: MembershipRole.MEMBER,
          }),
        }),
      );
    });
  });

  describe('invite — existing pending user (already in another org)', () => {
    it('creates membership and sends passwordless link for pending user', async () => {
      mockUsersService.findByEmail.mockResolvedValue(pendingUser);

      const result = await service.invite(
        pendingUser.email,
        MembershipRole.MEMBER,
        'org-1',
        inviterUser.id,
      );

      expect(result).toEqual({ message: 'Invitation sent successfully.' });
      expect(mockUsersService.createUser).not.toHaveBeenCalled();
      expect(mockMembershipsService.createMembership).toHaveBeenCalledWith(
        'org-1',
        {
          userId: pendingUser.id,
          role: MembershipRole.MEMBER,
          status: 'INVITED',
        },
        inviterUser.id,
        'user_action',
      );
      // Pending user still needs to activate their account via magic link
      expect(mockIdentityProvider.sendInviteLink).toHaveBeenCalledWith(
        pendingUser.email,
        'http://localhost:4200/auth/callback',
      );
    });
  });

  describe('invite — existing user (social / google-oauth2 connection)', () => {
    it('creates membership without sending a passwordless link', async () => {
      const socialUser = {
        id: 'u-social',
        email: 'social@example.com',
        auth0Id: 'google-oauth2|123456789',
      };
      mockUsersService.findByEmail.mockResolvedValue(socialUser);

      const result = await service.invite(
        socialUser.email,
        MembershipRole.MEMBER,
        'org-1',
        inviterUser.id,
      );

      expect(result).toEqual({ message: 'Invitation sent successfully.' });
      expect(mockUsersService.createUser).not.toHaveBeenCalled();
      // Existing social user gets ACTIVE immediately (already has a real Auth0 ID)
      expect(mockMembershipsService.createMembership).toHaveBeenCalledWith(
        'org-1',
        {
          userId: socialUser.id,
          role: MembershipRole.MEMBER,
          status: 'ACTIVE',
        },
        inviterUser.id,
        'user_action',
      );
      // Social-connection users cannot receive a passwordless link (Auth0 rejects with 400)
      expect(mockIdentityProvider.sendInviteLink).not.toHaveBeenCalled();

      // USER_INVITED event is still published for social users
      expect(mockEventBus.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'user.invited',
          payload: expect.objectContaining({
            inviteeEmail: socialUser.email,
          }),
        }),
      );
    });
  });

  describe('invite — new user (not in Prisma)', () => {
    it('creates a pending Prisma user, creates membership, and sends invite email', async () => {
      mockUsersService.findByEmail.mockResolvedValue(null);
      mockUsersService.createUser.mockResolvedValue(pendingUser);

      const result = await service.invite(
        pendingUser.email,
        MembershipRole.MEMBER,
        'org-1',
        inviterUser.id,
      );

      expect(result).toEqual({ message: 'Invitation sent successfully.' });

      // Must create a pending Prisma record (no Auth0 pre-creation)
      expect(mockUsersService.createUser).toHaveBeenCalledWith(
        expect.stringMatching(new RegExp(`^${PENDING_USER_PREFIX}`)),
        pendingUser.email,
      );

      // Membership created for the pending user
      expect(mockMembershipsService.createMembership).toHaveBeenCalledWith(
        'org-1',
        {
          userId: pendingUser.id,
          role: MembershipRole.MEMBER,
          status: 'INVITED',
        },
        inviterUser.id,
        'user_action',
      );

      // Passwordless invite sent via Auth0
      expect(mockIdentityProvider.sendInviteLink).toHaveBeenCalledWith(
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
          existingUser.email,
          MembershipRole.MEMBER,
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
          existingUser.email,
          MembershipRole.MEMBER,
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
        'NEWBIE@EXAMPLE.COM',
        MembershipRole.MEMBER,
        'org-1',
        inviterUser.id,
      );

      // Lookup must use the normalized address
      expect(mockUsersService.findByEmail).toHaveBeenCalledWith(
        'newbie@example.com',
      );
      // Pending user must be stored with normalized address
      expect(mockUsersService.createUser).toHaveBeenCalledWith(
        expect.stringMatching(new RegExp(`^${PENDING_USER_PREFIX}`)),
        'newbie@example.com',
      );
    });
  });

  describe('invite — org resolves to null (not found via null return)', () => {
    it('throws NotFoundException when findById resolves to null', async () => {
      // Covers the `if (!org)` null-check branch (line 65)
      mockOrganizationsService.findById.mockResolvedValue(null);
      mockUsersService.findByEmail.mockResolvedValue(existingUser);

      await expect(
        service.invite(
          existingUser.email,
          MembershipRole.MEMBER,
          'org-null',
          inviterUser.id,
        ),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
