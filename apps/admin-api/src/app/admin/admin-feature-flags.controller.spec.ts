import { vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { AdminFeatureFlagsController } from './admin-feature-flags.controller';
import { AdminEntitlementsService } from '@libs/admin/entitlements';
import type { EntitlementOverrideRecord } from '@libs/admin/entitlements';
import { SetFeatureFlagOverrideDto } from './dto/admin.dto';

const ACTOR_ADMIN_ID = 'admin-uuid-001';
const ORG_ID = 'org-uuid-001';

const mockAdminEntitlementsService = {
  setOverride: vi.fn(),
  deleteOverride: vi.fn(),
} as unknown as AdminEntitlementsService;

describe('AdminFeatureFlagsController', () => {
  let controller: AdminFeatureFlagsController;

  beforeEach(() => {
    vi.clearAllMocks();
    controller = new AdminFeatureFlagsController(mockAdminEntitlementsService);
  });

  describe('setOverride()', () => {
    it('delegates to service and returns the override record', async () => {
      const dto: SetFeatureFlagOverrideDto = {
        key: 'ssoEnabled',
        value: true,
        reason: 'Enterprise trial',
      };
      const mockRecord: EntitlementOverrideRecord = {
        id: 'override-uuid-001',
        orgId: ORG_ID,
        key: 'ssoEnabled',
        value: true,
        reason: 'Enterprise trial',
        expiresAt: null,
        createdBy: ACTOR_ADMIN_ID,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      mockAdminEntitlementsService.setOverride = vi
        .fn()
        .mockResolvedValue(mockRecord);

      const result = await controller.setOverride(ORG_ID, dto, ACTOR_ADMIN_ID);

      expect(result).toBe(mockRecord);
      expect(mockAdminEntitlementsService.setOverride).toHaveBeenCalledWith(
        ORG_ID,
        dto,
        ACTOR_ADMIN_ID,
      );
    });

    it('propagates errors from the service', async () => {
      mockAdminEntitlementsService.setOverride = vi
        .fn()
        .mockRejectedValue(new Error('DB error'));

      const dto: SetFeatureFlagOverrideDto = {
        key: 'maxSeats',
        value: 50,
        reason: 'Volume deal',
      };
      await expect(
        controller.setOverride(ORG_ID, dto, ACTOR_ADMIN_ID),
      ).rejects.toThrow('DB error');
    });
  });

  describe('deleteOverride()', () => {
    it('delegates to service and resolves without a return value', async () => {
      mockAdminEntitlementsService.deleteOverride = vi
        .fn()
        .mockResolvedValue(undefined);

      await controller.deleteOverride(ORG_ID, 'ssoEnabled', ACTOR_ADMIN_ID);

      expect(mockAdminEntitlementsService.deleteOverride).toHaveBeenCalledWith(
        ORG_ID,
        'ssoEnabled',
        ACTOR_ADMIN_ID,
      );
    });

    it('propagates NotFoundException from the service', async () => {
      mockAdminEntitlementsService.deleteOverride = vi
        .fn()
        .mockRejectedValue(new NotFoundException('No override found'));

      await expect(
        controller.deleteOverride(ORG_ID, 'ssoEnabled', ACTOR_ADMIN_ID),
      ).rejects.toThrow('No override found');
    });
  });
});
