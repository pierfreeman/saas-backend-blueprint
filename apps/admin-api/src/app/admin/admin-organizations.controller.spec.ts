import { vi } from 'vitest';
import { AdminOrganizationsController } from './admin-organizations.controller';
import { AdminOrganizationsService } from '@libs/admin/organizations';
import { ListOrganizationsQueryDto } from './dto/admin.dto';

const mockAdminOrgsService = {
  listOrganizations: vi.fn(),
  getOrganizationDetail: vi.fn(),
} as unknown as AdminOrganizationsService;

describe('AdminOrganizationsController', () => {
  let controller: AdminOrganizationsController;

  beforeEach(() => {
    vi.clearAllMocks();
    controller = new AdminOrganizationsController(mockAdminOrgsService);
  });

  describe('listOrganizations()', () => {
    it('delegates to service with extracted query params and defaults', async () => {
      const mockResult = { items: [], total: 0, limit: 20, offset: 0 };
      mockAdminOrgsService.listOrganizations = vi
        .fn()
        .mockResolvedValue(mockResult);

      const query: ListOrganizationsQueryDto = {
        search: 'acme',
      } as ListOrganizationsQueryDto;
      const result = await controller.listOrganizations(query);

      expect(result).toBe(mockResult);
      expect(mockAdminOrgsService.listOrganizations).toHaveBeenCalledWith(
        { search: 'acme', status: undefined },
        { limit: 20, offset: 0 },
      );
    });

    it('passes provided limit and offset to the service', async () => {
      const mockResult = { items: [], total: 0, limit: 10, offset: 5 };
      mockAdminOrgsService.listOrganizations = vi
        .fn()
        .mockResolvedValue(mockResult);

      const query = {
        limit: 10,
        offset: 5,
        status: 'ACTIVE',
      } as ListOrganizationsQueryDto;
      await controller.listOrganizations(query);

      expect(mockAdminOrgsService.listOrganizations).toHaveBeenCalledWith(
        { search: undefined, status: 'ACTIVE' },
        { limit: 10, offset: 5 },
      );
    });

    it('propagates errors from the service', async () => {
      mockAdminOrgsService.listOrganizations = vi
        .fn()
        .mockRejectedValue(new Error('Database error'));

      await expect(
        controller.listOrganizations({} as ListOrganizationsQueryDto),
      ).rejects.toThrow('Database error');
    });
  });

  describe('getOrganizationDetail()', () => {
    it('delegates to service with the orgId param', async () => {
      const mockDetail = { id: 'org-1', name: 'Acme' };
      mockAdminOrgsService.getOrganizationDetail = vi
        .fn()
        .mockResolvedValue(mockDetail);

      const result = await controller.getOrganizationDetail('org-1');

      expect(result).toBe(mockDetail);
      expect(mockAdminOrgsService.getOrganizationDetail).toHaveBeenCalledWith(
        'org-1',
      );
    });

    it('propagates NotFoundException from the service', async () => {
      const { NotFoundException } = await import('@nestjs/common');
      mockAdminOrgsService.getOrganizationDetail = vi
        .fn()
        .mockRejectedValue(new NotFoundException('Organization not found'));

      await expect(
        controller.getOrganizationDetail('nonexistent'),
      ).rejects.toThrow('Organization not found');
    });
  });

  describe('triggerExport()', () => {
    it('delegates to service and returns exportId', async () => {
      const mockResult = { exportId: 'export-uuid' };
      mockAdminOrgsService.requestExport = vi
        .fn()
        .mockResolvedValue(mockResult);

      const result = await controller.triggerExport('org-1', 'admin-1');

      expect(result).toBe(mockResult);
      expect(mockAdminOrgsService.requestExport).toHaveBeenCalledWith(
        'org-1',
        'admin-1',
      );
    });
  });

  describe('listExports()', () => {
    it('delegates to service with orgId and query params', async () => {
      const mockResult = { items: [], total: 0 };
      mockAdminOrgsService.listExports = vi.fn().mockResolvedValue(mockResult);

      const result = await controller.listExports('org-1', {
        limit: 10,
        offset: 0,
      });

      expect(result).toBe(mockResult);
      expect(mockAdminOrgsService.listExports).toHaveBeenCalledWith(
        'org-1',
        10,
        0,
      );
    });
  });

  describe('getExport()', () => {
    it('delegates to service with orgId and exportId', async () => {
      const mockExport = { id: 'export-1', orgId: 'org-1', status: 'PENDING' };
      mockAdminOrgsService.getExport = vi.fn().mockResolvedValue(mockExport);

      const result = await controller.getExport('org-1', 'export-1');

      expect(result).toBe(mockExport);
      expect(mockAdminOrgsService.getExport).toHaveBeenCalledWith(
        'export-1',
        'org-1',
      );
    });
  });
});
