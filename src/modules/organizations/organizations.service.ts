import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Organization, OrganizationStatus } from '@prisma/client';
import { CreateOrganizationDto } from './dto/create-organization.dto';
import { UpdateOrganizationDto } from './dto/update-organization.dto';
import { MembershipsService } from '../memberships/memberships.service';
import { EventBusService } from '../../events/event-bus.service';

@Injectable()
export class OrganizationsService {
  private readonly logger = new Logger(OrganizationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly membershipsService: MembershipsService,
    private readonly eventBus: EventBusService,
  ) {}

  async createOrganization(userId: string, dto: CreateOrganizationDto): Promise<Organization> {
    this.logger.log(`Creating organization "${dto.name}" for user ${userId}`);

    try {
      const organization = await this.prisma.$transaction(async (tx) => {
        // Create organization
        const org = await tx.organization.create({
          data: {
            name: dto.name,
            status: OrganizationStatus.ACTIVE,
          },
        });

        // Create automatic OWNER membership
        await tx.membership.create({
          data: {
            userId,
            orgId: org.id,
            role: 'OWNER',
          },
        });

        this.logger.log(`Organization ${org.id} created with OWNER membership for user ${userId}`);

        return org;
      });

      // Emit organization created event
      this.eventBus.emit({
        eventType: 'organization.created',
        timestamp: new Date(),
        organizationId: organization.id,
        userId,
        payload: {
          organizationId: organization.id,
          organizationName: organization.name,
          ownerId: userId,
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
    const organization = await this.prisma.organization.findUnique({
      where: { id },
    });

    if (!organization) {
      throw new NotFoundException(`Organization ${id} not found`);
    }

    return organization;
  }

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
    const organization = await this.findById(id);

    const updated = await this.prisma.organization.update({
      where: { id: organization.id },
      data: dto,
    });

    // Emit organization updated event
    this.eventBus.emit({
      eventType: 'organization.updated',
      timestamp: new Date(),
      organizationId: id,
      userId: userId,
      payload: {
        organizationId: id,
        changes: dto,
        previousName: organization.name,
        newName: updated.name,
      },
    });

    this.logger.log(`Organization ${id} updated`);

    return updated;
  }

  async deleteOrganization(id: string, userId?: string): Promise<void> {
    const organization = await this.findById(id);

    await this.prisma.organization.delete({
      where: { id },
    });

    // Emit organization deleted event
    this.eventBus.emit({
      eventType: 'organization.deleted',
      timestamp: new Date(),
      organizationId: id,
      userId: userId,
      payload: {
        organizationId: id,
        organizationName: organization.name,
        deletedAt: new Date().toISOString(),
      },
    });

    this.logger.log(`Organization ${id} deleted`);
  }

  async isActive(id: string): Promise<boolean> {
    const organization = await this.findById(id);
    return organization.status === OrganizationStatus.ACTIVE;
  }
}
