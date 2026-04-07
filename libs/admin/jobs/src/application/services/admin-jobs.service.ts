import { Injectable } from '@nestjs/common';
import { AdminJobsRepository } from '../../infrastructure/repositories/admin-jobs.repository';
import type {
  ListJobsQuery,
  PaginatedAdminJobsResult,
} from '../../dto/admin-jobs.dto';

@Injectable()
export class AdminJobsService {
  constructor(private readonly repository: AdminJobsRepository) {}

  async getOrgJobs(
    orgId: string,
    query: ListJobsQuery = {},
  ): Promise<PaginatedAdminJobsResult> {
    return this.repository.findByOrg(orgId, query);
  }
}
