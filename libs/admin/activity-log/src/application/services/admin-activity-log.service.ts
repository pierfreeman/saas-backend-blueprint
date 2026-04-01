import { Injectable } from '@nestjs/common';
import { ActivityLogService } from '@libs/activity-log';
import { AdminActivityLogRepository } from '../../infrastructure/repositories/admin-activity-log.repository';
import type {
  GetAllActivityQuery,
  GetOrgActivityQuery,
  PaginatedAdminActivityResult,
} from '../../dto/admin-activity-log.dto';

@Injectable()
export class AdminActivityLogService {
  constructor(
    private readonly repository: AdminActivityLogRepository,
    private readonly activityLog: ActivityLogService,
  ) {}

  /**
   * Returns paginated activity logs for a single organization.
   * Delegates to the existing ActivityLogService (same query path as tenant API).
   */
  async getOrgActivity(
    orgId: string,
    query: GetOrgActivityQuery = {},
  ): Promise<PaginatedAdminActivityResult> {
    return this.activityLog.findByOrg(orgId, query);
  }

  /**
   * Returns paginated activity logs across all organizations.
   * Supports optional org filter, action prefix filter, and date range.
   * Admin-only — not exposed to tenant users.
   */
  async getAllActivity(
    query: GetAllActivityQuery = {},
  ): Promise<PaginatedAdminActivityResult> {
    return this.repository.findAll(query);
  }
}
