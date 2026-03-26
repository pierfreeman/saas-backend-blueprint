import { AuthService, PENDING_AUTH0_ID_PREFIX } from './auth.service';
import { UsersService } from '@libs/users';
import { Auth0ManagementService } from './auth0-management.service';
import { Mock, vi } from 'vitest';

const mockUsersService = {
  findByAuth0Id: vi.fn(),
  findByEmail: vi.fn(),
  updateEmail: vi.fn(),
  updateAuth0Id: vi.fn(),
  findById: vi.fn(),
  provisionWithPersonalOrg: vi.fn(),
} as unknown as UsersService;

const mockAuth0ManagementService = {
  getUserById: vi.fn(),
} as unknown as Auth0ManagementService;

describe('AuthService', () => {
  let service: AuthService;

  beforeEach(() => {
    vi.clearAllMocks();
    // Default: no pending user found by email
    (mockUsersService.findByEmail as Mock).mockResolvedValue(null);
    service = new AuthService(mockUsersService, mockAuth0ManagementService);
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
      (
        mockUsersService.provisionWithPersonalOrg as Mock
      ).mockResolvedValue(createdUser);

      const result = await service.syncUser('auth0|1', 'a@b.com');

      expect(result).toBe(createdUser);
      expect(mockUsersService.provisionWithPersonalOrg).toHaveBeenCalledWith(
        'auth0|1',
        'a@b.com',
      );
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
        auth0Id: `${PENDING_AUTH0_ID_PREFIX}some-uuid`,
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

  describe('syncUser — Management API email resolution (no Post-Login Action)', () => {
    it('resolves real email from Management API when JWT contains placeholder', async () => {
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
      (mockAuth0ManagementService.getUserById as Mock).mockResolvedValue({
        user_id: auth0Id,
        email: realEmail,
        email_verified: true,
        identities: [],
      });
      (mockUsersService.findByEmail as Mock).mockResolvedValue(null);
      (
        mockUsersService.provisionWithPersonalOrg as Mock
      ).mockResolvedValue(createdUser);

      const result = await service.syncUser(auth0Id, placeholderEmail);

      expect(result).toBe(createdUser);
      expect(mockAuth0ManagementService.getUserById).toHaveBeenCalledWith(
        auth0Id,
      );
      expect(mockUsersService.provisionWithPersonalOrg).toHaveBeenCalledWith(
        auth0Id,
        realEmail,
      );
    });

    it('links pending invited user when Management API resolves email', async () => {
      const auth0Id = 'auth0|456';
      const placeholderEmail = `${auth0Id}@auth0.placeholder`;
      const realEmail = 'invited@example.com';
      const pending = {
        id: 'u-pending',
        auth0Id: `${PENDING_AUTH0_ID_PREFIX}some-uuid`,
        email: realEmail,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      const linked = { ...pending, auth0Id };

      (mockUsersService.findByAuth0Id as Mock).mockResolvedValue(null);
      (mockAuth0ManagementService.getUserById as Mock).mockResolvedValue({
        user_id: auth0Id,
        email: realEmail,
        email_verified: true,
        identities: [],
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

    it('falls back to placeholder email when Management API call fails', async () => {
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
      (mockAuth0ManagementService.getUserById as Mock).mockRejectedValue(
        new Error('Management API unavailable'),
      );
      (mockUsersService.findByEmail as Mock).mockResolvedValue(null);
      (
        mockUsersService.provisionWithPersonalOrg as Mock
      ).mockResolvedValue(createdUser);

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
        auth0Id: `${PENDING_AUTH0_ID_PREFIX}some-uuid`,
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
      (mockUsersService.findByEmail as Mock).mockResolvedValue(
        existingOtpUser,
      );
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

  describe('syncUser — email normalization', () => {
    it('normalizes JWT email to lowercase before lookup and storage', async () => {
      const pending = {
        id: 'u-pending',
        auth0Id: `${PENDING_AUTH0_ID_PREFIX}some-uuid`,
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

  describe('syncUser — pending invited user (passwordless / Google signup)', () => {
    it('links the real Auth0 ID when an invited pending user logs in for the first time', async () => {
      const pending = {
        id: 'u-pending',
        auth0Id: `${PENDING_AUTH0_ID_PREFIX}some-uuid`,
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
      (mockUsersService.findByEmail as Mock).mockResolvedValue(
        existingOtpUser,
      );
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
      (
        mockUsersService.provisionWithPersonalOrg as Mock
      ).mockRejectedValue(new Error('Transaction aborted'));

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
});
