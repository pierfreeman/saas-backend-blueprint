import { vi } from 'vitest';
import { RBACCacheService } from './rbac-cache.service';
import { RBACContextData } from './rbac.service';
import { CacheService } from '@libs/redis';
import { MembershipRole, MembershipStatus } from '@libs/prisma-business';
import { PERMISSIONS } from '@libs/common';

// ─── Mock Setup ──────────────────────────────────────────────────────────────

const mockCacheService = {
  get: vi.fn(),
  set: vi.fn(),
  del: vi.fn(),
  keys: vi.fn(),
} as unknown as CacheService;

const USER_ID = 'user-uuid-1';
const ORG_ID = 'org-uuid-1';

function makeContext(
  overrides: Partial<RBACContextData> = {},
): RBACContextData {
  return {
    userId: USER_ID,
    orgId: ORG_ID,
    role: MembershipRole.ADMIN,
    status: MembershipStatus.ACTIVE,
    permissions: [PERMISSIONS.ORG_MANAGE, PERMISSIONS.ORG_READ],
    ...overrides,
  };
}

describe('RBACCacheService', () => {
  let service: RBACCacheService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new RBACCacheService(mockCacheService);
  });

  // ── Key Construction ───────────────────────────────────────────────────────

  describe('key construction', () => {
    it('constructs key with pattern rbac:user:<userId>:org:<orgId>', async () => {
      const context = makeContext();
      mockCacheService.set = vi.fn().mockResolvedValue(undefined);

      await service.set(context);

      expect(mockCacheService.set).toHaveBeenCalledWith(
        `rbac:user:${USER_ID}:org:${ORG_ID}`,
        context,
        600,
      );
    });
  });

  // ── get / set round-trip ───────────────────────────────────────────────────

  describe('get / set round-trip', () => {
    it('stores and retrieves context with correct TTL (600s)', async () => {
      const context = makeContext();
      mockCacheService.set = vi.fn().mockResolvedValue(undefined);
      mockCacheService.get = vi.fn().mockResolvedValue(context);

      await service.set(context);
      const result = await service.get(USER_ID, ORG_ID);

      expect(mockCacheService.set).toHaveBeenCalledWith(
        `rbac:user:${USER_ID}:org:${ORG_ID}`,
        context,
        600,
      );
      expect(mockCacheService.get).toHaveBeenCalledWith(
        `rbac:user:${USER_ID}:org:${ORG_ID}`,
      );
      expect(result).toEqual(context);
    });

    it('returns null when cache entry does not exist', async () => {
      mockCacheService.get = vi.fn().mockResolvedValue(null);

      const result = await service.get(USER_ID, ORG_ID);

      expect(result).toBeNull();
    });
  });

  // ── invalidate ─────────────────────────────────────────────────────────────

  describe('invalidate', () => {
    it('calls cache.del with the correct key', async () => {
      mockCacheService.del = vi.fn().mockResolvedValue(undefined);

      await service.invalidate(USER_ID, ORG_ID);

      expect(mockCacheService.del).toHaveBeenCalledWith(
        `rbac:user:${USER_ID}:org:${ORG_ID}`,
      );
    });
  });

  // ── invalidateUser ─────────────────────────────────────────────────────────

  describe('invalidateUser', () => {
    it('pattern-matches and deletes all org entries for the user', async () => {
      const keys = [
        `rbac:user:${USER_ID}:org:org-1`,
        `rbac:user:${USER_ID}:org:org-2`,
        `rbac:user:${USER_ID}:org:org-3`,
      ];
      mockCacheService.keys = vi.fn().mockResolvedValue(keys);
      mockCacheService.del = vi.fn().mockResolvedValue(undefined);

      await service.invalidateUser(USER_ID);

      expect(mockCacheService.keys).toHaveBeenCalledWith(
        `rbac:user:${USER_ID}:org:*`,
      );
      expect(mockCacheService.del).toHaveBeenCalledTimes(3);
      expect(mockCacheService.del).toHaveBeenCalledWith(keys[0]);
      expect(mockCacheService.del).toHaveBeenCalledWith(keys[1]);
      expect(mockCacheService.del).toHaveBeenCalledWith(keys[2]);
    });

    it('does not call del when no keys are found', async () => {
      mockCacheService.keys = vi.fn().mockResolvedValue([]);

      await service.invalidateUser(USER_ID);

      expect(mockCacheService.keys).toHaveBeenCalledWith(
        `rbac:user:${USER_ID}:org:*`,
      );
      expect(mockCacheService.del).not.toHaveBeenCalled();
    });
  });

  // ── invalidateOrg ──────────────────────────────────────────────────────────

  describe('invalidateOrg', () => {
    it('pattern-matches and deletes all user entries for the org', async () => {
      const keys = [
        `rbac:user:user-1:org:${ORG_ID}`,
        `rbac:user:user-2:org:${ORG_ID}`,
        `rbac:user:user-3:org:${ORG_ID}`,
      ];
      mockCacheService.keys = vi.fn().mockResolvedValue(keys);
      mockCacheService.del = vi.fn().mockResolvedValue(undefined);

      await service.invalidateOrg(ORG_ID);

      expect(mockCacheService.keys).toHaveBeenCalledWith(
        `rbac:user:*:org:${ORG_ID}`,
      );
      expect(mockCacheService.del).toHaveBeenCalledTimes(3);
      expect(mockCacheService.del).toHaveBeenCalledWith(keys[0]);
      expect(mockCacheService.del).toHaveBeenCalledWith(keys[1]);
      expect(mockCacheService.del).toHaveBeenCalledWith(keys[2]);
    });

    it('does not call del when no keys are found', async () => {
      mockCacheService.keys = vi.fn().mockResolvedValue([]);

      await service.invalidateOrg(ORG_ID);

      expect(mockCacheService.keys).toHaveBeenCalledWith(
        `rbac:user:*:org:${ORG_ID}`,
      );
      expect(mockCacheService.del).not.toHaveBeenCalled();
    });
  });
});
