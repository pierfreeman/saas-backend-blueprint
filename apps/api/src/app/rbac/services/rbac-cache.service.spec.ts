import { RBACCacheService } from './rbac-cache.service';
import { CacheService } from '@libs/redis';
import { RBACContextData } from './rbac.service';
import { MembershipRole, MembershipStatus } from '@prisma/client';

const mockCache = {
  get: jest.fn(),
  set: jest.fn(),
  del: jest.fn(),
  keys: jest.fn(),
} as unknown as CacheService;

const ctx: RBACContextData = {
  userId: 'u-1',
  orgId: 'org-1',
  role: 'ADMIN' as MembershipRole,
  status: 'ACTIVE' as MembershipStatus,
  permissions: ['org.read', 'org.manage'],
};

describe('RBACCacheService', () => {
  let service: RBACCacheService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new RBACCacheService(mockCache);
  });

  describe('get', () => {
    it('returns cached context when present', async () => {
      mockCache.get = jest.fn().mockResolvedValue(ctx);
      const result = await service.get('u-1', 'org-1');
      expect(result).toBe(ctx);
      expect(mockCache.get).toHaveBeenCalledWith('rbac:user:u-1:org:org-1');
    });

    it('returns null when cache misses', async () => {
      mockCache.get = jest.fn().mockResolvedValue(null);
      expect(await service.get('u-1', 'org-x')).toBeNull();
    });
  });

  describe('set', () => {
    it('stores context with 600s TTL', async () => {
      mockCache.set = jest.fn().mockResolvedValue(undefined);
      await service.set(ctx);
      expect(mockCache.set).toHaveBeenCalledWith(
        'rbac:user:u-1:org:org-1',
        ctx,
        600,
      );
    });
  });

  describe('invalidate', () => {
    it('deletes the specific user+org cache key', async () => {
      mockCache.del = jest.fn().mockResolvedValue(undefined);
      await service.invalidate('u-1', 'org-1');
      expect(mockCache.del).toHaveBeenCalledWith('rbac:user:u-1:org:org-1');
    });
  });

  describe('invalidateUser', () => {
    it('deletes all org keys for a user', async () => {
      mockCache.keys = jest
        .fn()
        .mockResolvedValue([
          'rbac:user:u-1:org:org-1',
          'rbac:user:u-1:org:org-2',
        ]);
      mockCache.del = jest.fn().mockResolvedValue(undefined);

      await service.invalidateUser('u-1');

      expect(mockCache.keys).toHaveBeenCalledWith('rbac:user:u-1:org:*');
      expect(mockCache.del).toHaveBeenCalledTimes(2);
    });

    it('is a no-op when no keys found', async () => {
      mockCache.keys = jest.fn().mockResolvedValue([]);
      mockCache.del = jest.fn();
      await service.invalidateUser('u-1');
      expect(mockCache.del).not.toHaveBeenCalled();
    });
  });

  describe('invalidateOrg', () => {
    it('deletes all user keys for an org', async () => {
      mockCache.keys = jest
        .fn()
        .mockResolvedValue([
          'rbac:user:u-1:org:org-1',
          'rbac:user:u-2:org:org-1',
        ]);
      mockCache.del = jest.fn().mockResolvedValue(undefined);

      await service.invalidateOrg('org-1');

      expect(mockCache.keys).toHaveBeenCalledWith('rbac:user:*:org:org-1');
      expect(mockCache.del).toHaveBeenCalledTimes(2);
    });
  });
});
