import { Test, TestingModule } from '@nestjs/testing';
import { ActivityLogService } from '@libs/activity-log';
import { EventBusService } from '@libs/events';
import { PrismaBusinessService } from '@libs/prisma-business';
import { NotFoundException } from '@nestjs/common';
import { JobStatus } from '@prisma/client';
import { DataExportsService } from './data-exports.service';
import { ExportFormat } from './dto/create-export.dto';

describe('DataExportsService', () => {
  let service: DataExportsService;
  let prisma: jest.Mocked<PrismaBusinessService>;
  let eventBus: jest.Mocked<EventBusService>;
  let activityLog: jest.Mocked<ActivityLogService>;

  const mockJob = {
    id: 'job-123',
    orgId: 'org-456',
    userId: 'user-789',
    type: 'data_export',
    status: JobStatus.PENDING,
    payload: {
      orgId: 'org-456',
      format: ExportFormat.JSON,
      requestedBy: 'user-789',
      requestedAt: '2026-03-10T10:00:00.000Z',
    },
    result: null,
    error: null,
    attempts: 0,
    startedAt: null,
    finishedAt: null,
    createdAt: new Date('2026-03-10T10:00:00.000Z'),
    updatedAt: new Date('2026-03-10T10:00:00.000Z'),
  };

  beforeEach(async () => {
    const mockPrisma = {
      job: {
        create: jest.fn(),
        findFirst: jest.fn(),
      },
    };

    const mockEventBus = {
      publish: jest.fn(),
    };

    const mockActivityLog = {
      logActivity: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DataExportsService,
        { provide: PrismaBusinessService, useValue: mockPrisma },
        { provide: EventBusService, useValue: mockEventBus },
        { provide: ActivityLogService, useValue: mockActivityLog },
      ],
    }).compile();

    service = module.get<DataExportsService>(DataExportsService);
    prisma = module.get(PrismaBusinessService);
    eventBus = module.get(EventBusService);
    activityLog = module.get(ActivityLogService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createExport', () => {
    it('should create a data export job with PENDING status', async () => {
      prisma.job.create.mockResolvedValue(mockJob);

      const result = await service.createExport(
        'org-456',
        'user-789',
        ExportFormat.JSON,
      );

      expect(result).toEqual(mockJob);
      expect(prisma.job.create).toHaveBeenCalledWith({
        data: {
          orgId: 'org-456',
          userId: 'user-789',
          type: 'data_export',
          status: JobStatus.PENDING,
          payload: expect.objectContaining({
            orgId: 'org-456',
            format: ExportFormat.JSON,
            requestedBy: 'user-789',
          }),
        },
      });
    });

    it('should log activity when creating export job', async () => {
      prisma.job.create.mockResolvedValue(mockJob);

      await service.createExport('org-456', 'user-789', ExportFormat.JSON);

      expect(activityLog.logActivity).toHaveBeenCalledWith({
        orgId: 'org-456',
        actorId: 'user-789',
        action: 'data_export.requested',
        entityType: 'organization',
        entityId: 'org-456',
        metadata: {
          jobId: mockJob.id,
          format: ExportFormat.JSON,
        },
      });
    });

    it('should publish DATA_EXPORT_REQUESTED event to SQS', async () => {
      prisma.job.create.mockResolvedValue(mockJob);

      await service.createExport('org-456', 'user-789', ExportFormat.JSON);

      expect(eventBus.publish).toHaveBeenCalledWith({
        eventType: 'data.export.requested',
        payload: {
          jobId: mockJob.id,
          orgId: 'org-456',
          format: ExportFormat.JSON,
        },
        metadata: expect.objectContaining({
          source: 'data-exports.service',
        }),
      });
    });

    it('should default to JSON format if not specified', async () => {
      prisma.job.create.mockResolvedValue(mockJob);

      await service.createExport('org-456', 'user-789');

      expect(prisma.job.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          payload: expect.objectContaining({
            format: ExportFormat.JSON,
          }),
        }),
      });
    });
  });

  describe('getExportStatus', () => {
    it('should return job details when job exists', async () => {
      prisma.job.findFirst.mockResolvedValue(mockJob);

      const result = await service.getExportStatus('job-123', 'org-456');

      expect(result).toEqual(mockJob);
      expect(prisma.job.findFirst).toHaveBeenCalledWith({
        where: {
          id: 'job-123',
          orgId: 'org-456',
          type: 'data_export',
        },
      });
    });

    it('should throw NotFoundException when job does not exist', async () => {
      prisma.job.findFirst.mockResolvedValue(null);

      await expect(
        service.getExportStatus('job-123', 'org-456'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException when job belongs to different org (tenant isolation)', async () => {
      prisma.job.findFirst.mockResolvedValue(null);

      await expect(
        service.getExportStatus('job-123', 'wrong-org-id'),
      ).rejects.toThrow(NotFoundException);

      expect(prisma.job.findFirst).toHaveBeenCalledWith({
        where: {
          id: 'job-123',
          orgId: 'wrong-org-id',
          type: 'data_export',
        },
      });
    });
  });
});
