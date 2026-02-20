import { Test, TestingModule } from '@nestjs/testing';
import { RBACCacheService } from '../services/rbac-cache.service';
import { RedisService } from '../../../redis/redis.service';
import { RBACContext } from '../services/rbac.service';
import { MembershipRole, MembershipStatus } from '@prisma/client';

describe('RBACCacheService', () => {
  let service: RBACCacheService;
  let redis: RedisService;

  const mockRedisService = {
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
    keys: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RBACCacheService,
        {
          provide: RedisService,
          useValue: mockRedisService,
        },
      ],
    }).compile();

    service = module.get<RBACCacheService>(RBACCacheService);
    redis = module.get<RedisService>(RedisService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('get', () => {
    it('should return null if no cached data', async () => {
      mockRedisService.get.mockResolvedValue(null);

      const result = await service.get('user-1', 'org-1');

      expect(result).toBeNull();
      expect(mockRedisService.get).toHaveBeenCalledWith('rbac:user:user-1:org:org-1');
    });

    it('should return cached RBAC context', async () => {
      const mockContext: RBACContext = {
        userId: 'user-1',
        orgId: 'org-1',
        role: MembershipRole.ADMIN,
        status: MembershipStatus.ACTIVE,
        permissions: ['team.create', 'team.read'],
      };

      mockRedisService.get.mockResolvedValue(JSON.stringify(mockContext));

      const result = await service.get('user-1', 'org-1');

      expect(result).toEqual(mockContext);
    });
  });

  describe('set', () => {
    it('should set RBAC context in cache', async () => {
      const mockContext: RBACContext = {
        userId: 'user-1',
        orgId: 'org-1',
        role: MembershipRole.ADMIN,
        status: MembershipStatus.ACTIVE,
        permissions: ['team.create', 'team.read'],
      };

      await service.set(mockContext);

      expect(mockRedisService.set).toHaveBeenCalledWith(
        'rbac:user:user-1:org:org-1',
        JSON.stringify(mockContext),
        600, // TTL
      );
    });
  });

  describe('invalidate', () => {
    it('should delete cache entry', async () => {
      await service.invalidate('user-1', 'org-1');

      expect(mockRedisService.del).toHaveBeenCalledWith('rbac:user:user-1:org:org-1');
    });
  });

  describe('invalidateUser', () => {
    it('should invalidate all entries for a user', async () => {
      mockRedisService.keys.mockResolvedValue([
        'rbac:user:user-1:org:org-1',
        'rbac:user:user-1:org:org-2',
      ]);

      await service.invalidateUser('user-1');

      expect(mockRedisService.keys).toHaveBeenCalledWith('rbac:user:user-1:org:*');
      expect(mockRedisService.del).toHaveBeenCalledTimes(2);
    });
  });

  describe('invalidateOrg', () => {
    it('should invalidate all entries for an org', async () => {
      mockRedisService.keys.mockResolvedValue([
        'rbac:user:user-1:org:org-1',
        'rbac:user:user-2:org:org-1',
      ]);

      await service.invalidateOrg('org-1');

      expect(mockRedisService.keys).toHaveBeenCalledWith('rbac:user:*:org:org-1');
      expect(mockRedisService.del).toHaveBeenCalledTimes(2);
    });
  });
});
