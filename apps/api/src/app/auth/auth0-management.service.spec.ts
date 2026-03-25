import { Auth0ManagementService } from './auth0-management.service';

const mockGet = jest.fn();
const mockPost = jest.fn();
const mockAxiosGet = jest.fn();
const mockAxiosDelete = jest.fn();

// Mock axios instance — supports post (token + passwordless), get and delete
jest.mock('axios', () => ({
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
    jest.clearAllMocks();
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
});
