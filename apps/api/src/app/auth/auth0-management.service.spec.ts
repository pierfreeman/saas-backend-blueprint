import { Auth0ManagementService } from './auth0-management.service';
import { Mock, vi } from 'vitest';

const mockGet = vi.fn();
const mockPost = vi.fn();
const mockAxiosGet = vi.fn();
const mockAxiosDelete = vi.fn();

// Mock axios instance — supports post (token + passwordless), get and delete
vi.mock('axios', () => ({
  create: () => ({
    post: mockPost,
    get: mockAxiosGet,
    delete: mockAxiosDelete,
  }),
  __esModule: true,
  default: {
    create: () => ({
      post: mockPost,
      get: mockAxiosGet,
      delete: mockAxiosDelete,
    }),
  },
}));

const mockConfigService = {
  get: mockGet,
} as never;

function buildService() {
  return new Auth0ManagementService(mockConfigService);
}

describe('Auth0ManagementService', () => {
  let service: Auth0ManagementService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGet.mockImplementation((key: string) => {
      const cfg: Record<string, string> = {
        'auth.domain': 'test.auth0.com',
        'auth.m2mClientId': 'client-id',
        'auth.m2mClientSecret': 'client-secret',
      };
      return cfg[key];
    });
    // Default: token endpoint responds with a valid token
    mockPost.mockImplementation((url: string) => {
      if (url.includes('/oauth/token')) {
        return Promise.resolve({
          data: {
            access_token: 'mgmt-token',
            expires_in: 86400,
            token_type: 'Bearer',
          },
        });
      }
      return Promise.resolve({ data: {} });
    });
    service = buildService();
  });

  describe('findUsersByEmail', () => {
    it('fetches an M2M token then queries users by email', async () => {
      const auth0Users = [
        {
          user_id: 'google-oauth2|123',
          email: 'alice@example.com',
          email_verified: true,
          identities: [],
        },
      ];
      mockAxiosGet.mockResolvedValue({ data: auth0Users });

      const result = await service.findUsersByEmail('alice@example.com');

      expect(result).toEqual(auth0Users);
      expect(mockPost).toHaveBeenCalledWith(
        expect.stringContaining('/oauth/token'),
        expect.any(Object),
      );
      expect(mockAxiosGet).toHaveBeenCalledWith(
        expect.stringContaining('/api/v2/users-by-email'),
        expect.objectContaining({
          params: { email: 'alice@example.com' },
        }),
      );
    });

    it('returns an empty array when no users match', async () => {
      mockAxiosGet.mockResolvedValue({ data: [] });

      const result = await service.findUsersByEmail('unknown@example.com');
      expect(result).toEqual([]);
    });
  });

  describe('M2M credentials missing', () => {
    it('throws when credentials are not configured', async () => {
      mockGet.mockReturnValue(undefined);
      service = buildService();

      await expect(service.findUsersByEmail('foo@bar.com')).rejects.toThrow(
        'Auth0 M2M credentials are not configured',
      );
    });
  });

  describe('token caching', () => {
    it('reuses a cached token without calling the token endpoint again', async () => {
      mockAxiosGet.mockResolvedValue({ data: [] });

      // First call fetches a fresh token
      await service.findUsersByEmail('a@example.com');
      expect(mockPost).toHaveBeenCalledTimes(1);

      // Second call should reuse the cached token
      await service.findUsersByEmail('b@example.com');
      expect(mockPost).toHaveBeenCalledTimes(1);
    });
  });

  describe('getUserById', () => {
    it('fetches a user by their Auth0 user_id', async () => {
      const auth0User = {
        user_id: 'google-oauth2|123',
        email: 'alice@example.com',
        email_verified: true,
        identities: [
          { connection: 'google-oauth2', provider: 'google-oauth2' },
        ],
      };
      mockAxiosGet.mockResolvedValue({ data: auth0User });

      const result = await service.getUserById('google-oauth2|123');

      expect(result).toEqual(auth0User);
      expect(mockAxiosGet).toHaveBeenCalledWith(
        'https://test.auth0.com/api/v2/users/google-oauth2%7C123',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer mgmt-token',
          }),
        }),
      );
    });

    it('propagates errors from the HTTP request', async () => {
      mockAxiosGet.mockRejectedValue(new Error('User not found'));

      await expect(service.getUserById('auth0|unknown')).rejects.toThrow(
        'User not found',
      );
    });
  });

  describe('deleteUser', () => {
    it('sends a DELETE request to the users endpoint with encoded auth0UserId', async () => {
      mockAxiosDelete.mockResolvedValue({});

      await service.deleteUser('google-oauth2|abc123');

      expect(mockAxiosDelete).toHaveBeenCalledWith(
        'https://test.auth0.com/api/v2/users/google-oauth2%7Cabc123',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer mgmt-token',
          }),
        }),
      );
    });

    it('fetches a fresh M2M token before deleting', async () => {
      mockAxiosDelete.mockResolvedValue({});

      await service.deleteUser('auth0|xyz');

      expect(mockPost).toHaveBeenCalledWith(
        expect.stringContaining('/oauth/token'),
        expect.any(Object),
      );
    });

    it('propagates errors from the HTTP request', async () => {
      mockAxiosDelete.mockRejectedValue(new Error('Auth0 network error'));

      await expect(service.deleteUser('auth0|xyz')).rejects.toThrow(
        'Auth0 network error',
      );
    });
  });

  describe('sendPasswordlessLink', () => {
    beforeEach(() => {
      mockGet.mockImplementation((key: string) => {
        const cfg: Record<string, string> = {
          'auth.domain': 'test.auth0.com',
          'auth.m2mClientId': 'client-id',
          'auth.m2mClientSecret': 'client-secret',
          'auth.spaClientId': 'spa-client-id',
        };
        return cfg[key];
      });
    });

    it('sends a passwordless link via the Auth0 Authentication API', async () => {
      mockPost.mockImplementation((url: string) => {
        if (url.includes('/oauth/token')) {
          return Promise.resolve({
            data: {
              access_token: 'mgmt-token',
              expires_in: 86400,
              token_type: 'Bearer',
            },
          });
        }
        return Promise.resolve({ data: {} });
      });

      await service.sendPasswordlessLink(
        'alice@example.com',
        'https://app.example.com/callback',
      );

      expect(mockPost).toHaveBeenCalledWith(
        'https://test.auth0.com/passwordless/start',
        expect.objectContaining({
          client_id: 'spa-client-id',
          connection: 'email',
          email: 'alice@example.com',
          send: 'code',
          authParams: expect.objectContaining({
            redirect_uri: 'https://app.example.com/callback',
          }),
        }),
      );
    });

    it('throws when Auth0 SPA client ID is not configured', async () => {
      mockGet.mockImplementation((key: string) => {
        const cfg: Record<string, string> = {
          'auth.domain': 'test.auth0.com',
        };
        return cfg[key];
      });
      service = buildService();

      await expect(
        service.sendPasswordlessLink(
          'alice@example.com',
          'https://app.example.com/callback',
        ),
      ).rejects.toThrow('Auth0 SPA client ID is not configured');
    });

    it('throws when Auth0 domain is not configured', async () => {
      mockGet.mockReturnValue(undefined);
      service = buildService();

      await expect(
        service.sendPasswordlessLink(
          'alice@example.com',
          'https://app.example.com/callback',
        ),
      ).rejects.toThrow('Auth0 SPA client ID is not configured');
    });

    it('propagates errors from the HTTP request', async () => {
      mockPost.mockImplementation((url: string) => {
        if (url.includes('/oauth/token')) {
          return Promise.resolve({
            data: {
              access_token: 'mgmt-token',
              expires_in: 86400,
              token_type: 'Bearer',
            },
          });
        }
        return Promise.reject(new Error('Passwordless API error'));
      });

      await expect(
        service.sendPasswordlessLink(
          'alice@example.com',
          'https://app.example.com/callback',
        ),
      ).rejects.toThrow('Passwordless API error');
    });
  });

  describe('sendChangePasswordEmail', () => {
    beforeEach(() => {
      mockGet.mockImplementation((key: string) => {
        const cfg: Record<string, string> = {
          'auth.domain': 'test.auth0.com',
          'auth.m2mClientId': 'client-id',
          'auth.m2mClientSecret': 'client-secret',
          'auth.spaClientId': 'spa-client-id',
        };
        return cfg[key];
      });
    });

    it('sends a change-password request to the Auth0 dbconnections endpoint', async () => {
      mockPost.mockResolvedValue({ data: {} });

      await service.sendChangePasswordEmail('alice@example.com');

      expect(mockPost).toHaveBeenCalledWith(
        'https://test.auth0.com/dbconnections/change_password',
        {
          client_id: 'spa-client-id',
          email: 'alice@example.com',
          connection: 'Username-Password-Authentication',
        },
      );
    });

    it('does NOT fetch an M2M token (Authentication API — no token required)', async () => {
      mockPost.mockResolvedValue({ data: {} });

      await service.sendChangePasswordEmail('alice@example.com');

      // The only post call should be to the change_password endpoint, not /oauth/token
      expect(mockPost).toHaveBeenCalledTimes(1);
      expect(mockPost).not.toHaveBeenCalledWith(
        expect.stringContaining('/oauth/token'),
        expect.anything(),
      );
    });

    it('throws when Auth0 SPA client ID is not configured', async () => {
      mockGet.mockImplementation((key: string) => {
        const cfg: Record<string, string> = {
          'auth.domain': 'test.auth0.com',
        };
        return cfg[key];
      });
      service = buildService();

      await expect(
        service.sendChangePasswordEmail('alice@example.com'),
      ).rejects.toThrow('Auth0 SPA client ID is not configured');
    });

    it('throws when Auth0 domain is not configured', async () => {
      mockGet.mockReturnValue(undefined);
      service = buildService();

      await expect(
        service.sendChangePasswordEmail('alice@example.com'),
      ).rejects.toThrow('Auth0 SPA client ID is not configured');
    });

    it('propagates errors from the HTTP request', async () => {
      mockPost.mockRejectedValue(new Error('Auth0 API error'));

      await expect(
        service.sendChangePasswordEmail('alice@example.com'),
      ).rejects.toThrow('Auth0 API error');
    });
  });
});
