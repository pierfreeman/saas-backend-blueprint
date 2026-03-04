import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaBusinessService } from '@libs/prisma-business';
import { ActivityLogService } from '@libs/activity-log';
import { LegalAuditService } from '@libs/legal-audit';
import { Organization, MembershipRole } from '@prisma/client';
import { CreateOrganizationDto } from './dto/create-organization.dto';
import { UpdateOrganizationDto } from './dto/update-organization.dto';

@Injectable()
export class OrganizationsService {
  private readonly logger = new Logger(OrganizationsService.name);

  constructor(
    private readonly prisma: PrismaBusinessService,
    private readonly activityLog: ActivityLogService,
    private readonly legalAudit: LegalAuditService,
  ) {}

  /**
   * Creates a new organization and automatically assigns the creator as OWNER.
   * Both operations run inside a single transaction.
   */
  async createOrganization(
    userId: string,
    dto: CreateOrganizationDto,
  ): Promise<Organization> {
    this.logger.log(`Creating organization "${dto.name}" for user ${userId}`);

    try {
      const organization = await this.prisma.$transaction(async (tx) => {
        const org = await tx.organization.create({
          data: { name: dto.name },
        });

        await tx.membership.create({
          data: { userId, orgId: org.id, role: MembershipRole.OWNER },
        });

        return org;
      });

      this.logger.log(`Organization ${organization.id} created`);

      // ISO 27001 A.8.15 - business activity log (tenant-visible)
      this.activityLog.logActivity({
        orgId: organization.id,
        actorId: userId,
        action: 'organization.created',
        entityType: 'organization',
        entityId: organization.id,
        metadata: { name: organization.name },
      });

      // ISO 27001 A.8.15 - legal compliance record (immutable, separate DB)
      this.legalAudit.recordEvent({
        eventType: 'organization.created',
        orgId: organization.id,
        triggerType: 'user',
        metadata: { organizationId: organization.id, name: organization.name, userId },
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
    const org = await this.prisma.organization.findUnique({ where: { id } });

    if (!org) {
      throw new NotFoundException(`Organization ${id} not found`);
    }

    return org;
  }

  /** Returns all organizations the given user belongs to. */
  async findByUserId(userId: string): Promise<Organization[]> {
    const memberships = await this.prisma.membership.findMany({
      where: { userId },
      include: { organization: true },
    });

    return memberships.map((m) => m.organization);
  }

  async updateOrganization(
    id: string,
    dto: UpdateOrganizationDto,
    userId?: string,
  ): Promise<Organization> {
    await this.findById(id);

    const updated = await this.prisma.organization.update({
      where: { id },
      data: dto,
    });

    this.logger.log(`Organization ${id} updated`);

    // ISO 27001 A.8.15 - business activity log
    this.activityLog.logActivity({
      orgId: id,
      actorId: userId ?? null,
      action: 'organization.updated',
      entityType: 'organization',
      entityId: id,
      metadata: { changes: dto as Record<string, unknown> },
    });

    // ISO 27001 A.8.15 - legal compliance record
    this.legalAudit.recordEvent({
      eventType: 'organization.updated',
      orgId: id,
      triggerType: 'user',
      metadata: { organizationId: id, changes: dto as Record<string, unknown>, userId: userId ?? null },
    });

    return updated;
  }

  async deleteOrganization(id: string, userId?: string): Promise<void> {
    const org = await this.findById(id);
    await this.prisma.organization.delete({ where: { id } });
    this.logger.log(`Organization ${id} deleted`);

    // Activity log is cascade-deleted with the org - legal record is permanent
    // ISO 27001 A.8.15 / GDPR Art. 5 - legal compliance record (survives deletion)
    this.legalAudit.recordEvent({
      eventType: 'organization.deleted',
      orgId: id,
      triggerType: 'user',
      metadata: { organizationId: id, name: org.name, userId: userId ?? null },
    });
  }
}
