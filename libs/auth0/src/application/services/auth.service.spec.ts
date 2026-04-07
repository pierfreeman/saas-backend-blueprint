import { AuthService } from './auth.service';
import { IIdentityProvider } from '../../domain/ports/identity-provider.interface';
import { UsersService } from '@libs/users';
import { EmailService } from '@libs/email';
import { ActivityLogService } from '@libs/activity-log';
import { LegalAuditService } from '@libs/legal-audit';
import { MembershipsService } from '@libs/memberships';
import { PENDING_USER_PREFIX } from '../../constants';
import { Mock, vi } from 'vitest';

const mockUsersService = {
  findByAuth0Id: vi.fn(),
  findByEmail: vi.fn(),
  updateEmail: vi.fn(),
  updateAuth0Id: vi.fn(),
  findById: vi.fn(),
  provisionWithPersonalOrg: vi.fn(),
  updateProfile: vi.fn(),
} as unknown as UsersService;

const mockIdentityProvider = {
  getUserById: vi.fn(),
  findUsersByEmail: vi.fn(),
  deleteUser: vi.fn(),
  sendInviteLink: vi.fn(),
  sendChangePasswordEmail: vi.fn(),
} as unknown as IIdentityProvider;

const mockEmailService = {
  addContact: vi.fn(),
} as unknown as EmailService;

const mockActivityLog = {
  logActivity: vi.fn(),
} as unknown as ActivityLogService;

const mockLegalAudit = {
  recordEvent: vi.fn(),
} as unknown as LegalAuditService;

const mockMembershipsService = {
  activateInvitedMemberships: vi.fn(),
} as unknown as MembershipsService;

const mockOrganization = {
  id: 'org-1',
  name: 'Personal Workspace',
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('AuthService', () => {
  let service: AuthService;

  beforeEach(() => {
    vi.clearAllMocks();
    // Default: no pending user found by email
    (mockUsersService.findByEmail as Mock).mockResolvedValue(null);
    service = new AuthService(
      mockUsersService,
      mockIdentityProvider,
      mockEmailService,
      mockActivityLog,
      mockLegalAudit,
      mockMembershipsService,
    );
  });

  describe('syncUser', () => {
    it('provisions new user + personal org when no existing or pending user', async () => {
      const createdUser = {
        id: 'u-1',
        auth0Id: 'auth0|1',
        email: 'a@b.com',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      (mockUsersService.findByAuth0Id as Mock).mockResolvedValue(null);
      (mockUsersService.findByEmail as Mock).mockResolvedValue(null);
      (mockUsersService.provisionWithPersonalOrg as Mock).mockResolvedValue({
        user: createdUser,
        organization: mockOrganization,
      });

      const result = await service.syncUser('auth0|1', 'a@b.com');

      expect(result).toBe(createdUser);
      expect(mockUsersService.provisionWithPersonalOrg).toHaveBeenCalledWith(
        'auth0|1',
        'a@b.com',
      );
    });

    it('calls emailService.addContact when provisioning a new user', async () => {
      const createdUser = {
        id: 'u-1',
        auth0Id: 'auth0|1',
        email: 'new@example.com',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      (mockUsersService.findByAuth0Id as Mock).mockResolvedValue(null);
      (mockUsersService.findByEmail as Mock).mockResolvedValue(null);
      (mockUsersService.provisionWithPersonalOrg as Mock).mockResolvedValue({
        user: createdUser,
        organization: mockOrganization,
      });

      await service.syncUser('auth0|1', 'new@example.com');

      expect(mockEmailService.addContact).toHaveBeenCalledWith({
        email: 'new@example.com',
        firstName: undefined,
        lastName: undefined,
        properties: {
          org_id: 'org-1',
          org_name: 'Personal Workspace',
        },
      });
    });

    it('does not call emailService.addContact for returning users', async () => {
      const existing = {
        id: 'u-1',
        auth0Id: 'auth0|1',
        email: 'a@b.com',
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      (mockUsersService.findByAuth0Id as Mock).mockResolvedValue(existing);

      await service.syncUser('auth0|1', 'a@b.com');

      expect(mockEmailService.addContact).not.toHaveBeenCalled();
    });

    it('returns existing user when email is unchanged — no update', async () => {
      const existing = {
        id: 'u-1',
        auth0Id: 'auth0|1',
        email: 'a@b.com',
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      (mockUsersService.findByAuth0Id as Mock).mockResolvedValue(existing);

      const result = await service.syncUser('auth0|1', 'a@b.com');
      expect(result).toBe(existing);
      expect(mockUsersService.updateEmail).not.toHaveBeenCalled();
    });

    it('updates email when it has changed', async () => {
      const existing = {
        id: 'u-1',
        auth0Id: 'auth0|1',
        email: 'old@b.com',
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      const updated = { ...existing, email: 'new@b.com' };
      (mockUsersService.findByAuth0Id as Mock).mockResolvedValue(existing);
      (mockUsersService.updateEmail as Mock).mockResolvedValue(updated);

      const result = await service.syncUser('auth0|1', 'new@b.com');
      expect(result).toBe(updated);
      expect(mockUsersService.updateEmail).toHaveBeenCalledWith(
        'u-1',
        'new@b.com',
      );
    });

    it('does not overwrite a real email with the placeholder when user is found by auth0Id', async () => {
      const existing = {
        id: 'u-1',
        auth0Id: 'auth0|1',
        email: 'real@example.com',
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      (mockUsersService.findByAuth0Id as Mock).mockResolvedValue(existing);

      const result = await service.syncUser(
        'auth0|1',
        'auth0|1@auth0.placeholder',
      );
      expect(result).toBe(existing);
      expect(mockUsersService.updateEmail).not.toHaveBeenCalled();
    });
  });

  describe('syncUser — email normalization', () => {
    it('normalizes JWT email to lowercase before lookup and storage', async () => {
      const pending = {
        id: 'u-pending',
        auth0Id: `${PENDING_USER_PREFIX}some-uuid`,
        email: 'invited@example.com',
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      const linked = { ...pending, auth0Id: 'google-oauth2|456' };

      (mockUsersService.findByAuth0Id as Mock).mockResolvedValue(null);
      // The JWT delivers 'Invited@Example.com' but the stored email is lowercase
      (mockUsersService.findByEmail as Mock).mockResolvedValue(pending);
      (mockUsersService.updateAuth0Id as Mock).mockResolvedValue(linked);

      const result = await service.syncUser(
        'google-oauth2|456',
        'Invited@Example.COM',
      );

      expect(result).toBe(linked);
      // findByEmail must be called with the normalized (lowercase) address
      expect(mockUsersService.findByEmail).toHaveBeenCalledWith(
        'invited@example.com',
      );
      expect(mockUsersService.provisionWithPersonalOrg).not.toHaveBeenCalled();
    });
  });

  describe('syncUser — identity provider email resolution (no Post-Login Action)', () => {
    it('resolves real email from identity provider when JWT contains placeholder', async () => {
      const auth0Id = 'auth0|123';
      const placeholderEmail = `${auth0Id}@auth0.placeholder`;
      const realEmail = 'real@example.com';
      const createdUser = {
        id: 'u-new',
        auth0Id,
        email: realEmail,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      (mockUsersService.findByAuth0Id as Mock).mockResolvedValue(null);
      (mockIdentityProvider.getUserById as Mock).mockResolvedValue({
        externalId: auth0Id,
        email: realEmail,
        emailVerified: true,
        connections: [],
      });
      (mockUsersService.findByEmail as Mock).mockResolvedValue(null);
      (mockUsersService.provisionWithPersonalOrg as Mock).mockResolvedValue({
        user: createdUser,
        organization: mockOrganization,
      });

      const result = await service.syncUser(auth0Id, placeholderEmail);

      expect(result).toBe(createdUser);
      expect(mockIdentityProvider.getUserById).toHaveBeenCalledWith(auth0Id);
      expect(mockUsersService.provisionWithPersonalOrg).toHaveBeenCalledWith(
        auth0Id,
        realEmail,
      );
    });

    it('links pending invited user when identity provider resolves email', async () => {
      const auth0Id = 'auth0|456';
      const placeholderEmail = `${auth0Id}@auth0.placeholder`;
      const realEmail = 'invited@example.com';
      const pending = {
        id: 'u-pending',
        auth0Id: `${PENDING_USER_PREFIX}some-uuid`,
        email: realEmail,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      const linked = { ...pending, auth0Id };

      (mockUsersService.findByAuth0Id as Mock).mockResolvedValue(null);
      (mockIdentityProvider.getUserById as Mock).mockResolvedValue({
        externalId: auth0Id,
        email: realEmail,
        emailVerified: true,
        connections: [],
      });
      (mockUsersService.findByEmail as Mock).mockResolvedValue(pending);
      (mockUsersService.updateAuth0Id as Mock).mockResolvedValue(linked);

      const result = await service.syncUser(auth0Id, placeholderEmail);

      expect(result).toBe(linked);
      expect(mockUsersService.updateAuth0Id).toHaveBeenCalledWith(
        'u-pending',
        auth0Id,
      );
      expect(mockUsersService.provisionWithPersonalOrg).not.toHaveBeenCalled();
    });

    it('falls back to placeholder email when identity provider call fails', async () => {
      const auth0Id = 'auth0|789';
      const placeholderEmail = `${auth0Id}@auth0.placeholder`;
      const createdUser = {
        id: 'u-new',
        auth0Id,
        email: placeholderEmail,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      (mockUsersService.findByAuth0Id as Mock).mockResolvedValue(null);
      (mockIdentityProvider.getUserById as Mock).mockRejectedValue(
        new Error('Provider API unavailable'),
      );
      (mockUsersService.findByEmail as Mock).mockResolvedValue(null);
      (mockUsersService.provisionWithPersonalOrg as Mock).mockResolvedValue({
        user: createdUser,
        organization: mockOrganization,
      });

      const result = await service.syncUser(auth0Id, placeholderEmail);

      expect(result).toBe(createdUser);
      // Provisions with placeholder — degraded but never crashes
      expect(mockUsersService.provisionWithPersonalOrg).toHaveBeenCalledWith(
        auth0Id,
        placeholderEmail,
      );
    });
  });

  describe('syncUser — pending invited user (passwordless / Google signup)', () => {
    it('links the real Auth0 ID when an invited pending user logs in for the first time', async () => {
      const pending = {
        id: 'u-pending',
        auth0Id: `${PENDING_USER_PREFIX}some-uuid`,
        email: 'invited@example.com',
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      const linked = {
        ...pending,
        auth0Id: 'google-oauth2|456',
      };

      (mockUsersService.findByAuth0Id as Mock).mockResolvedValue(null);
      (mockUsersService.findByEmail as Mock).mockResolvedValue(pending);
      (mockUsersService.updateAuth0Id as Mock).mockResolvedValue(linked);

      const result = await service.syncUser(
        'google-oauth2|456',
        'invited@example.com',
      );

      expect(result).toBe(linked);
      expect(mockUsersService.updateAuth0Id).toHaveBeenCalledWith(
        'u-pending',
        'google-oauth2|456',
      );
      expect(mockUsersService.provisionWithPersonalOrg).not.toHaveBeenCalled();
    });

    it('relinks auth0Id when Auth0 account linking failed (non-pending user, same email, different auth0Id)', async () => {
      const existingOtpUser = {
        id: 'u-otp',
        auth0Id: 'email|otp-abc',
        email: 'someone@example.com',
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      const relinked = { ...existingOtpUser, auth0Id: 'google-oauth2|789' };

      (mockUsersService.findByAuth0Id as Mock).mockResolvedValue(null);
      // A non-pending user exists with this email (OTP account not yet linked)
      (mockUsersService.findByEmail as Mock).mockResolvedValue(existingOtpUser);
      (mockUsersService.updateAuth0Id as Mock).mockResolvedValue(relinked);

      const result = await service.syncUser(
        'google-oauth2|789',
        'someone@example.com',
      );

      expect(result).toBe(relinked);
      // Must relink — NOT create a new user (would violate unique email constraint)
      expect(mockUsersService.updateAuth0Id).toHaveBeenCalledWith(
        'u-otp',
        'google-oauth2|789',
      );
      expect(mockUsersService.provisionWithPersonalOrg).not.toHaveBeenCalled();
    });
  });

  describe('findUserByAuth0Id', () => {
    it('returns user when found', async () => {
      const user = {
        id: 'u-1',
        auth0Id: 'auth0|1',
        email: 'a@b.com',
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      (mockUsersService.findByAuth0Id as Mock).mockResolvedValue(user);
      expect(await service.findUserByAuth0Id('auth0|1')).toBe(user);
    });

    it('returns null when not found', async () => {
      (mockUsersService.findByAuth0Id as Mock).mockResolvedValue(null);
      expect(await service.findUserByAuth0Id('auth0|x')).toBeNull();
    });
  });

  describe('findUserById', () => {
    it('returns user by id', async () => {
      const user = {
        id: 'u-1',
        auth0Id: 'auth0|1',
        email: 'a@b.com',
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      (mockUsersService.findById as Mock).mockResolvedValue(user);
      expect(await service.findUserById('u-1')).toBe(user);
    });

    it('returns null when not found', async () => {
      (mockUsersService.findById as Mock).mockResolvedValue(null);
      expect(await service.findUserById('nonexistent')).toBeNull();
    });
  });

  describe('syncUser — edge cases', () => {
    it('propagates errors from provisionWithPersonalOrg', async () => {
      (mockUsersService.findByAuth0Id as Mock).mockResolvedValue(null);
      (mockUsersService.findByEmail as Mock).mockResolvedValue(null);
      (mockUsersService.provisionWithPersonalOrg as Mock).mockRejectedValue(
        new Error('Transaction aborted'),
      );

      await expect(service.syncUser('auth0|new', 'new@b.com')).rejects.toThrow(
        'Transaction aborted',
      );
    });

    it('propagates DB errors from findByAuth0Id', async () => {
      (mockUsersService.findByAuth0Id as Mock).mockRejectedValue(
        new Error('Connection refused'),
      );

      await expect(service.syncUser('auth0|1', 'a@b.com')).rejects.toThrow(
        'Connection refused',
      );
    });

    it('propagates DB errors from updateEmail', async () => {
      const existing = {
        id: 'u-1',
        auth0Id: 'auth0|1',
        email: 'old@b.com',
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      (mockUsersService.findByAuth0Id as Mock).mockResolvedValue(existing);
      (mockUsersService.updateEmail as Mock).mockRejectedValue(
        new Error('Update failed'),
      );

      await expect(service.syncUser('auth0|1', 'new@b.com')).rejects.toThrow(
        'Update failed',
      );
    });
  });

  describe('syncUser — profile sync on first login', () => {
    it('syncs firstName, lastName, pictureUrl from identity provider on first login', async () => {
      const auth0Id = 'google-oauth2|123';
      const email = 'social@example.com';
      const provisioned = {
        id: 'u-new',
        auth0Id,
        email,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      const updated = {
        ...provisioned,
        firstName: 'Alice',
        lastName: 'Smith',
        pictureUrl: 'https://example.com/pic.jpg',
      };

      (mockUsersService.findByAuth0Id as Mock).mockResolvedValue(null);
      (mockUsersService.findByEmail as Mock).mockResolvedValue(null);
      (mockUsersService.provisionWithPersonalOrg as Mock).mockResolvedValue({
        user: provisioned,
        organization: mockOrganization,
      });
      (mockIdentityProvider.getUserById as Mock).mockResolvedValue({
        externalId: auth0Id,
        email,
        emailVerified: true,
        connections: [],
        firstName: 'Alice',
        lastName: 'Smith',
        pictureUrl: 'https://example.com/pic.jpg',
      });
      (mockUsersService.updateProfile as Mock).mockResolvedValue(updated);

      const result = await service.syncUser(auth0Id, email);

      expect(result).toBe(updated);
      expect(mockUsersService.updateProfile).toHaveBeenCalledWith('u-new', {
        firstName: 'Alice',
        lastName: 'Smith',
        pictureUrl: 'https://example.com/pic.jpg',
      });
    });

    it('skips profile sync and returns provisioned user when identity provider profile fetch fails', async () => {
      const auth0Id = 'google-oauth2|456';
      const email = 'social2@example.com';
      const provisioned = {
        id: 'u-new2',
        auth0Id,
        email,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      (mockUsersService.findByAuth0Id as Mock).mockResolvedValue(null);
      (mockUsersService.findByEmail as Mock).mockResolvedValue(null);
      (mockUsersService.provisionWithPersonalOrg as Mock).mockResolvedValue({
        user: provisioned,
        organization: mockOrganization,
      });
      (mockIdentityProvider.getUserById as Mock).mockRejectedValue(
        new Error('Provider unavailable'),
      );

      const result = await service.syncUser(auth0Id, email);

      expect(result).toBe(provisioned);
      expect(mockUsersService.updateProfile).not.toHaveBeenCalled();
    });

    it('does not fetch profile for returning users', async () => {
      const existing = {
        id: 'u-1',
        auth0Id: 'auth0|1',
        email: 'a@b.com',
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      (mockUsersService.findByAuth0Id as Mock).mockResolvedValue(existing);

      await service.syncUser('auth0|1', 'a@b.com');

      expect(mockIdentityProvider.getUserById).not.toHaveBeenCalled();
      expect(mockUsersService.updateProfile).not.toHaveBeenCalled();
    });

    it('uses profile data passed directly to syncUser when available', async () => {
      const auth0Id = 'auth0|789';
      const email = 'direct@example.com';
      const provisioned = {
        id: 'u-new3',
        auth0Id,
        email,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      const updated = { ...provisioned, firstName: 'Dave' };

      (mockUsersService.findByAuth0Id as Mock).mockResolvedValue(null);
      (mockUsersService.findByEmail as Mock).mockResolvedValue(null);
      (mockUsersService.provisionWithPersonalOrg as Mock).mockResolvedValue({
        user: provisioned,
        organization: mockOrganization,
      });
      (mockUsersService.updateProfile as Mock).mockResolvedValue(updated);

      const result = await service.syncUser(auth0Id, email, {
        firstName: 'Dave',
      });

      // Identity provider should NOT be called when profile is already provided
      expect(mockIdentityProvider.getUserById).not.toHaveBeenCalled();
      expect(mockUsersService.updateProfile).toHaveBeenCalledWith('u-new3', {
        firstName: 'Dave',
      });
      expect(result).toBe(updated);
    });
  });

  describe('updateProfile', () => {
    it('delegates to usersService.updateProfile', async () => {
      const updated = {
        id: 'u-1',
        auth0Id: 'auth0|1',
        email: 'a@b.com',
        firstName: 'Alice',
        lastName: 'Smith',
        pictureUrl: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      (mockUsersService.updateProfile as Mock).mockResolvedValue(updated);

      const result = await service.updateProfile('u-1', {
        firstName: 'Alice',
        lastName: 'Smith',
      });

      expect(result).toBe(updated);
      expect(mockUsersService.updateProfile).toHaveBeenCalledWith('u-1', {
        firstName: 'Alice',
        lastName: 'Smith',
      });
    });

    it('propagates errors from usersService', async () => {
      (mockUsersService.updateProfile as Mock).mockRejectedValue(
        new Error('DB error'),
      );

      await expect(
        service.updateProfile('u-1', { firstName: 'X' }),
      ).rejects.toThrow('DB error');
    });
  });

  describe('syncUser — non-Error catch branches', () => {
    it('handles non-Error thrown by identity provider in both email and profile resolution', async () => {
      const auth0Id = 'auth0|non-error-test';
      const placeholderEmail = `${auth0Id}@auth0.placeholder`;
      const provisioned = {
        id: 'u-ne',
        auth0Id,
        email: placeholderEmail,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      (mockUsersService.findByAuth0Id as Mock).mockResolvedValue(null);
      // Throw a plain string (not an Error) to hit the err branch of the ternary
      (mockIdentityProvider.getUserById as Mock).mockRejectedValue(
        'non-error string failure',
      );
      (mockUsersService.findByEmail as Mock).mockResolvedValue(null);
      (mockUsersService.provisionWithPersonalOrg as Mock).mockResolvedValue({
        user: provisioned,
        organization: mockOrganization,
      });

      const result = await service.syncUser(auth0Id, placeholderEmail);

      // Must degrade gracefully — placeholder email is used and user is provisioned
      expect(result).toBe(provisioned);
      expect(mockUsersService.provisionWithPersonalOrg).toHaveBeenCalledWith(
        auth0Id,
        placeholderEmail,
      );
    });
  });

  describe('requestPasswordChange', () => {
    it('delegates to identityProvider.sendChangePasswordEmail', async () => {
      (mockIdentityProvider.sendChangePasswordEmail as Mock).mockResolvedValue(
        undefined,
      );

      await service.requestPasswordChange('alice@example.com');

      expect(mockIdentityProvider.sendChangePasswordEmail).toHaveBeenCalledWith(
        'alice@example.com',
      );
    });

    it('propagates errors from sendChangePasswordEmail', async () => {
      (mockIdentityProvider.sendChangePasswordEmail as Mock).mockRejectedValue(
        new Error('Auth0 error'),
      );

      await expect(
        service.requestPasswordChange('alice@example.com'),
      ).rejects.toThrow('Auth0 error');
    });
  });

  describe('syncUser — INVITED membership activation on first login', () => {
    it('activates INVITED memberships when a pending user links their real Auth0 ID', async () => {
      const pending = {
        id: 'u-pending',
        auth0Id: `${PENDING_USER_PREFIX}some-uuid`,
        email: 'invited@example.com',
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      const linked = { ...pending, auth0Id: 'auth0|real' };

      (mockUsersService.findByAuth0Id as Mock).mockResolvedValue(null);
      (mockUsersService.findByEmail as Mock).mockResolvedValue(pending);
      (mockUsersService.updateAuth0Id as Mock).mockResolvedValue(linked);
      (
        mockMembershipsService.activateInvitedMemberships as Mock
      ).mockResolvedValue(undefined);

      await service.syncUser('auth0|real', 'invited@example.com');

      expect(
        mockMembershipsService.activateInvitedMemberships,
      ).toHaveBeenCalledWith('u-pending');
    });

    it('does NOT activate memberships when relinking a non-pending user (Auth0 account link fallback)', async () => {
      const existingOtp = {
        id: 'u-otp',
        auth0Id: 'email|otp-old',
        email: 'otp@example.com',
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      const relinked = { ...existingOtp, auth0Id: 'google-oauth2|new' };

      (mockUsersService.findByAuth0Id as Mock).mockResolvedValue(null);
      (mockUsersService.findByEmail as Mock).mockResolvedValue(existingOtp);
      (mockUsersService.updateAuth0Id as Mock).mockResolvedValue(relinked);

      await service.syncUser('google-oauth2|new', 'otp@example.com');

      expect(
        mockMembershipsService.activateInvitedMemberships,
      ).not.toHaveBeenCalled();
    });
  });
});
