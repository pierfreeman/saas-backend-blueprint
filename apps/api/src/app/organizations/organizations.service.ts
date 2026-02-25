import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '@libs/prisma';
import { Organization, MembershipRole } from '@prisma/client';
import { CreateOrganizationDto } from './dto/create-organization.dto';
import { UpdateOrganizationDto } from './dto/update-organization.dto';

@Injectable()
export class OrganizationsService {
  private readonly logger = new Logger(OrganizationsService.name);

  constructor(private readonly prisma: PrismaService) {}

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
  ): Promise<Organization> {
    await this.findById(id);

    const updated = await this.prisma.organization.update({
      where: { id },
      data: dto,
    });

    this.logger.log(`Organization ${id} updated`);
    return updated;
  }

  async deleteOrganization(id: string): Promise<void> {
    await this.findById(id);
    await this.prisma.organization.delete({ where: { id } });
    this.logger.log(`Organization ${id} deleted`);
  }
}
