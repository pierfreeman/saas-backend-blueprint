import { Test, TestingModule } from '@nestjs/testing';
import { AdminActivityLogService } from './admin-activity-log.service';
import { AdminActivityLogRepository } from '../../infrastructure/repositories/admin-activity-log.repository';
import { ActivityLogService } from '@libs/activity-log';

const mockLog = {
  id: 'log-1',
  orgId: 'org-1',
  actorId: 'user-1',
  actorRole: 'OWNER',
  action: 'membership.created',
  entityType: 'membership',
  entityId: 'mem-1',
  metadata: {},
  createdAt: new Date('2024-06-01'),
};

const paginatedResult = {
  logs: [mockLog],
  total: 1,
  limit: 100,
  offset: 0,
};

describe('AdminActivityLogService', () => {
  let service: AdminActivityLogService;

  const mockRepository = {
    findAll: vi.fn(),
  };

  const mockActivityLog = {
    findByOrg: vi.fn(),
  };

  beforeEach(async () => {
    vi.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminActivityLogService,
        { provide: AdminActivityLogRepository, useValue: mockRepository },
        { provide: ActivityLogService, useValue: mockActivityLog },
      ],
    }).compile();

    service = module.get(AdminActivityLogService);
  });

  describe('getOrgActivity', () => {
    it('delegates to ActivityLogService.findByOrg', async () => {
      mockActivityLog.findByOrg.mockResolvedValue(paginatedResult);

      const result = await service.getOrgActivity('org-1', {
        limit: 20,
        offset: 0,
        action: 'membership.',
      });

      expect(mockActivityLog.findByOrg).toHaveBeenCalledWith('org-1', {
        limit: 20,
        offset: 0,
        action: 'membership.',
      });
      expect(result.total).toBe(1);
      expect(result.items[0].orgId).toBe('org-1');
    });

    it('uses empty options when none provided', async () => {
      mockActivityLog.findByOrg.mockResolvedValue(paginatedResult);

      await service.getOrgActivity('org-1');

      expect(mockActivityLog.findByOrg).toHaveBeenCalledWith('org-1', {});
    });
  });

  describe('getAllActivity', () => {
    it('delegates to repository.findAll for cross-org query', async () => {
      mockRepository.findAll.mockResolvedValue({
        items: [mockLog],
        total: 1,
        limit: 100,
        offset: 0,
      });

      const result = await service.getAllActivity({
        orgId: 'org-1',
        limit: 50,
        offset: 10,
      });

      expect(mockRepository.findAll).toHaveBeenCalledWith({
        orgId: 'org-1',
        limit: 50,
        offset: 10,
      });
      expect(result.items).toHaveLength(1);
    });

    it('passes empty query when no filters provided', async () => {
      mockRepository.findAll.mockResolvedValue({
        items: [],
        total: 0,
        limit: 100,
        offset: 0,
      });

      await service.getAllActivity();

      expect(mockRepository.findAll).toHaveBeenCalledWith({});
    });
  });
});
