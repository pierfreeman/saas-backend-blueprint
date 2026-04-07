import { vi } from 'vitest';
import { AdminJobsController } from './admin-jobs.controller';
import { AdminJobsService } from '@libs/admin/jobs';
import { JobStatus } from '@libs/prisma-business';
import { AdminListJobsQueryDto } from './dto/admin.dto';

const mockAdminJobsService = {
  getOrgJobs: vi.fn(),
} as unknown as AdminJobsService;

describe('AdminJobsController', () => {
  let controller: AdminJobsController;

  beforeEach(() => {
    vi.clearAllMocks();
    controller = new AdminJobsController(mockAdminJobsService);
  });

  describe('getOrgJobs()', () => {
    it('delegates to service with orgId and query', async () => {
      const mockResult = { items: [], total: 0, limit: 50, offset: 0 };
      mockAdminJobsService.getOrgJobs = vi.fn().mockResolvedValue(mockResult);

      const query: AdminListJobsQueryDto = {
        limit: 50,
        offset: 0,
        status: JobStatus.FAILED,
      } as AdminListJobsQueryDto;

      const result = await controller.getOrgJobs('org-1', query);

      expect(result).toBe(mockResult);
      expect(mockAdminJobsService.getOrgJobs).toHaveBeenCalledWith(
        'org-1',
        query,
      );
    });

    it('propagates errors from the service', async () => {
      mockAdminJobsService.getOrgJobs = vi
        .fn()
        .mockRejectedValue(new Error('Service error'));

      await expect(
        controller.getOrgJobs('org-1', {} as AdminListJobsQueryDto),
      ).rejects.toThrow('Service error');
    });
  });
});
