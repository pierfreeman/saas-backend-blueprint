import { vi } from 'vitest';
import { AdminEntitlementsController } from './admin-entitlements.controller';
import { AdminEntitlementsService } from '@libs/admin/entitlements';
import type { EntitlementOverrideRecord } from '@libs/admin/entitlements';

const mockAdminEntitlementsService = {
  getEntitlements: vi.fn(),
  invalidateCache: vi.fn(),
  listOverrides: vi.fn(),
} as unknown as AdminEntitlementsService;

const ACTOR_ADMIN_ID = 'admin-user-id';

describe('AdminEntitlementsController', () => {
  let controller: AdminEntitlementsController;

  beforeEach(() => {
    vi.clearAllMocks();
    controller = new AdminEntitlementsController(mockAdminEntitlementsService);
  });

  describe('getEntitlements()', () => {
    it('delegates to service with orgId', async () => {
      const mockEntitlements = {
        plan: 'PRO',
        features: { analyticsExport: true },
      };
      mockAdminEntitlementsService.getEntitlements = vi
        .fn()
        .mockResolvedValue(mockEntitlements);

      const result = await controller.getEntitlements('org-1');

      expect(result).toBe(mockEntitlements);
      expect(mockAdminEntitlementsService.getEntitlements).toHaveBeenCalledWith(
        'org-1',
      );
    });

    it('propagates NotFoundException from the service', async () => {
      const { NotFoundException } = await import('@nestjs/common');
      mockAdminEntitlementsService.getEntitlements = vi
        .fn()
        .mockRejectedValue(new NotFoundException('Organization not found'));

      await expect(controller.getEntitlements('nonexistent')).rejects.toThrow(
        'Organization not found',
      );
    });
  });

  describe('invalidateCache()', () => {
    it('delegates to service with orgId and actorAdminId, returns success message', async () => {
      mockAdminEntitlementsService.invalidateCache = vi
        .fn()
        .mockResolvedValue(undefined);

      const result = await controller.invalidateCache('org-1', ACTOR_ADMIN_ID);

      expect(result).toEqual({ message: 'Entitlements cache invalidated.' });
      expect(mockAdminEntitlementsService.invalidateCache).toHaveBeenCalledWith(
        'org-1',
        ACTOR_ADMIN_ID,
      );
    });

    it('propagates errors from the service', async () => {
      mockAdminEntitlementsService.invalidateCache = vi
        .fn()
        .mockRejectedValue(new Error('Cache error'));

      await expect(
        controller.invalidateCache('org-1', ACTOR_ADMIN_ID),
      ).rejects.toThrow('Cache error');
    });
  });

  describe('listOverrides()', () => {
    it('delegates to service and returns override records', async () => {
      const mockOverrides: EntitlementOverrideRecord[] = [
        {
          id: 'override-1',
          orgId: 'org-1',
          key: 'ssoEnabled',
          value: true,
          reason: 'Enterprise trial',
          expiresAt: null,
          createdBy: ACTOR_ADMIN_ID,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];
      mockAdminEntitlementsService.listOverrides = vi
        .fn()
        .mockResolvedValue(mockOverrides);

      const result = await controller.listOverrides('org-1');

      expect(result).toBe(mockOverrides);
      expect(mockAdminEntitlementsService.listOverrides).toHaveBeenCalledWith(
        'org-1',
      );
    });

    it('returns an empty array when no overrides exist', async () => {
      mockAdminEntitlementsService.listOverrides = vi
        .fn()
        .mockResolvedValue([]);

      const result = await controller.listOverrides('org-1');

      expect(result).toEqual([]);
    });
  });
});
