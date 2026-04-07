import { vi } from 'vitest';
import { AdminActivityLogController } from './admin-activity-log.controller';
import { AdminActivityLogService } from '@libs/admin/activity-log';
import {
  AdminActivityQueryDto,
  AdminAllActivityQueryDto,
} from './dto/admin.dto';

const mockAdminActivityLogService = {
  getAllActivity: vi.fn(),
  getOrgActivity: vi.fn(),
} as unknown as AdminActivityLogService;

describe('AdminActivityLogController', () => {
  let controller: AdminActivityLogController;

  beforeEach(() => {
    vi.clearAllMocks();
    controller = new AdminActivityLogController(mockAdminActivityLogService);
  });

  describe('getAllActivity()', () => {
    it('delegates to service with the full query object', async () => {
      const mockResult = { items: [], total: 0, limit: 20, offset: 0 };
      mockAdminActivityLogService.getAllActivity = vi
        .fn()
        .mockResolvedValue(mockResult);

      const query: AdminAllActivityQueryDto = {
        limit: 20,
        offset: 0,
      } as AdminAllActivityQueryDto;
      const result = await controller.getAllActivity(query);

      expect(result).toBe(mockResult);
      expect(mockAdminActivityLogService.getAllActivity).toHaveBeenCalledWith(
        query,
      );
    });

    it('propagates errors from the service', async () => {
      mockAdminActivityLogService.getAllActivity = vi
        .fn()
        .mockRejectedValue(new Error('Query failed'));

      await expect(
        controller.getAllActivity({} as AdminAllActivityQueryDto),
      ).rejects.toThrow('Query failed');
    });
  });

  describe('getOrgActivity()', () => {
    it('delegates to service with orgId and the query object', async () => {
      const mockResult = { items: [], total: 0, limit: 20, offset: 0 };
      mockAdminActivityLogService.getOrgActivity = vi
        .fn()
        .mockResolvedValue(mockResult);

      const query: AdminActivityQueryDto = {
        limit: 10,
        offset: 5,
      } as AdminActivityQueryDto;
      const result = await controller.getOrgActivity('org-1', query);

      expect(result).toBe(mockResult);
      expect(mockAdminActivityLogService.getOrgActivity).toHaveBeenCalledWith(
        'org-1',
        query,
      );
    });
  });
});
