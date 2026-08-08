import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { ActivityLogService } from '@libs/activity-log';
import { LegalAuditService } from '@libs/legal-audit';
import { Organization, runWithTenant } from '@libs/prisma-business';
import { OrganizationsRepository } from '../../infrastructure/repositories/organizations.repository';

@Injectable()
export class OrganizationsService {
  private readonly logger = new Logger(OrganizationsService.name);

  constructor(
    private readonly repo: OrganizationsRepository,
    private readonly activityLog: ActivityLogService,
    private readonly legalAudit: LegalAuditService,
  ) {}

  async createOrganization(
    userId: string,
    dto: { name: string },
  ): Promise<Organization> {
    this.logger.log(`Creating organization "${dto.name}" for user ${userId}`);

    try {
      const organization = await this.repo.createWithOwner(dto.name, userId);

      this.logger.log(`Organization ${organization.id} created`);

      // The request's ambient tenant context (if any) predates this org's
      // existence — override it for this write so the activityLog Proxy
      // (libs/prisma-business) sets app.current_org_id to the org that was
      // just created, satisfying its RLS WITH CHECK.
      runWithTenant(organization.id, () => {
        this.activityLog.logActivity({
          orgId: organization.id,
          actorId: userId,
          action: 'organization.created',
          entityType: 'organization',
          entityId: organization.id,
          metadata: { name: organization.name },
        });
      });

      this.legalAudit.recordEvent({
        eventType: 'organization.created',
        orgId: organization.id,
        triggerType: 'user',
        metadata: {
          organizationId: organization.id,
          name: organization.name,
          userId,
        },
      });

      return organization;
    } catch (error) {
      this.logger.error(
        `Failed to create organization: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      throw new BadRequestException('Failed to create organization');
    }
  }

  async findById(id: string): Promise<Organization> {
    const org = await this.repo.findById(id);

    if (!org) {
      throw new NotFoundException(`Organization ${id} not found`);
    }

    return org;
  }

  async findByUserId(userId: string): Promise<Organization[]> {
    return this.repo.findByUserId(userId);
  }

  async updateOrganization(
    id: string,
    dto: { name?: string },
    userId?: string,
  ): Promise<Organization> {
    await this.findById(id);

    const updated = await this.repo.update(id, dto);

    this.logger.log(`Organization ${id} updated`);

    this.activityLog.logActivity({
      orgId: id,
      actorId: userId ?? null,
      action: 'organization.updated',
      entityType: 'organization',
      entityId: id,
      metadata: { changes: dto as Record<string, unknown> },
    });

    this.legalAudit.recordEvent({
      eventType: 'organization.updated',
      orgId: id,
      triggerType: 'user',
      metadata: {
        organizationId: id,
        changes: dto as Record<string, unknown>,
        userId: userId ?? null,
      },
    });

    return updated;
  }

  async deleteOrganization(id: string, userId?: string): Promise<void> {
    const org = await this.findById(id);

    await this.repo.deleteJobs(id);
    await this.repo.delete(id);

    this.logger.log(`Organization ${id} deleted`);

    this.activityLog.logActivity({
      orgId: id,
      actorId: userId ?? 'system',
      action: 'organization.deleted',
      entityType: 'organization',
      entityId: id,
      metadata: { name: org.name },
    });

    this.legalAudit.recordEvent({
      eventType: 'organization.deleted',
      orgId: id,
      triggerType: 'user',
      metadata: { organizationId: id, name: org.name, userId: userId ?? null },
    });
  }
}
