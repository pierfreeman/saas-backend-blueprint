import { Test, TestingModule } from '@nestjs/testing';
import { AdminJobsService } from './admin-jobs.service';
import { AdminJobsRepository } from '../../infrastructure/repositories/admin-jobs.repository';
import { JobStatus } from '@libs/prisma-business';

const mockJob = {
  id: 'job-1',
  orgId: 'org-1',
  userId: 'user-1',
  type: 'ORG_EXPORT',
  status: JobStatus.DONE,
  payload: {},
  result: null,
  error: null,
  attempts: 1,
  startedAt: new Date('2024-06-01'),
  finishedAt: new Date('2024-06-01'),
  createdAt: new Date('2024-06-01'),
  updatedAt: new Date('2024-06-01'),
};

const paginatedResult = {
  items: [mockJob],
  total: 1,
  limit: 50,
  offset: 0,
};

describe('AdminJobsService', () => {
  let service: AdminJobsService;

  const mockRepository = {
    findByOrg: vi.fn(),
  };

  beforeEach(async () => {
    vi.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminJobsService,
        { provide: AdminJobsRepository, useValue: mockRepository },
      ],
    }).compile();

    service = module.get(AdminJobsService);
  });

  describe('getOrgJobs', () => {
    it('delegates to repository.findByOrg with orgId and query', async () => {
      mockRepository.findByOrg.mockResolvedValue(paginatedResult);

      const result = await service.getOrgJobs('org-1', {
        limit: 20,
        offset: 0,
        status: JobStatus.FAILED,
      });

      expect(mockRepository.findByOrg).toHaveBeenCalledWith('org-1', {
        limit: 20,
        offset: 0,
        status: JobStatus.FAILED,
      });
      expect(result.total).toBe(1);
      expect(result.items[0].orgId).toBe('org-1');
    });

    it('uses empty options when none provided', async () => {
      mockRepository.findByOrg.mockResolvedValue(paginatedResult);

      await service.getOrgJobs('org-1');

      expect(mockRepository.findByOrg).toHaveBeenCalledWith('org-1', {});
    });

    it('propagates errors from the repository', async () => {
      mockRepository.findByOrg.mockRejectedValue(new Error('DB error'));

      await expect(service.getOrgJobs('org-1')).rejects.toThrow('DB error');
    });
  });
});
