import { Test, TestingModule } from '@nestjs/testing';
import { ActivityLogController } from './activity-log.controller';
import { ActivityLogService } from '@libs/activity-log';
import { ActivityLogQueryDto } from './dto/activity-log-query.dto';
import { JwtAuthGuard } from '@libs/common';
import { OrgContextGuard } from '../rbac/guards/org-context.guard';
import { RBACGuard } from '../rbac/guards/rbac.guard';

const mockActivityLogService = {
  findByOrg: jest.fn(),
};

const allowAllGuard = { canActivate: () => true };

describe('ActivityLogController', () => {
  let controller: ActivityLogController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ActivityLogController],
      providers: [
        { provide: ActivityLogService, useValue: mockActivityLogService },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(allowAllGuard)
      .overrideGuard(OrgContextGuard)
      .useValue(allowAllGuard)
      .overrideGuard(RBACGuard)
      .useValue(allowAllGuard)
      .compile();

    controller = module.get<ActivityLogController>(ActivityLogController);
    jest.clearAllMocks();
  });

  describe('list', () => {
    const orgId = '00000000-0000-0000-0000-000000000001';

    it('returns paginated activity logs for the org', async () => {
      const result = { logs: [], total: 0, limit: 100, offset: 0 };
      mockActivityLogService.findByOrg.mockResolvedValue(result);

      const query: ActivityLogQueryDto = {};
      const response = await controller.list(orgId, query);

      expect(mockActivityLogService.findByOrg).toHaveBeenCalledWith(orgId, {
        limit: 100,
        offset: 0,
        action: undefined,
        fromDate: undefined,
        toDate: undefined,
      });
      expect(response).toEqual(result);
    });

    it('passes action filter to service', async () => {
      mockActivityLogService.findByOrg.mockResolvedValue({
        logs: [],
        total: 0,
        limit: 100,
        offset: 0,
      });

      const query: ActivityLogQueryDto = { action: 'membership.' };
      await controller.list(orgId, query);

      expect(mockActivityLogService.findByOrg).toHaveBeenCalledWith(
        orgId,
        expect.objectContaining({ action: 'membership.' }),
      );
    });

    it('passes date range to service', async () => {
      mockActivityLogService.findByOrg.mockResolvedValue({
        logs: [],
        total: 0,
        limit: 100,
        offset: 0,
      });

      const query: ActivityLogQueryDto = {
        fromDate: '2024-01-01T00:00:00.000Z',
        toDate: '2024-12-31T23:59:59.000Z',
      };
      await controller.list(orgId, query);

      expect(mockActivityLogService.findByOrg).toHaveBeenCalledWith(
        orgId,
        expect.objectContaining({
          fromDate: new Date('2024-01-01T00:00:00.000Z'),
          toDate: new Date('2024-12-31T23:59:59.000Z'),
        }),
      );
    });

    it('caps limit at 500', async () => {
      mockActivityLogService.findByOrg.mockResolvedValue({
        logs: [],
        total: 0,
        limit: 500,
        offset: 0,
      });

      const query: ActivityLogQueryDto = { limit: 999 };
      await controller.list(orgId, query);

      expect(mockActivityLogService.findByOrg).toHaveBeenCalledWith(
        orgId,
        expect.objectContaining({ limit: 500 }),
      );
    });

    it('passes pagination params to service', async () => {
      mockActivityLogService.findByOrg.mockResolvedValue({
        logs: [],
        total: 0,
        limit: 10,
        offset: 20,
      });

      const query: ActivityLogQueryDto = { limit: 10, offset: 20 };
      await controller.list(orgId, query);

      expect(mockActivityLogService.findByOrg).toHaveBeenCalledWith(
        orgId,
        expect.objectContaining({ limit: 10, offset: 20 }),
      );
    });
  });
});
