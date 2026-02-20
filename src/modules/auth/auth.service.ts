import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { User, Prisma } from '@prisma/client';
import { EventBusService } from '../../events/event-bus.service';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventBus: EventBusService,
  ) {}

  async syncUser(auth0Id: string, email: string): Promise<User> {
    console.log(`Syncing user with Auth0 ID: ${auth0Id} and email: ${email}`);
    // Check if user exists
    const existingUser = await this.prisma.user.findUnique({
      where: { auth0Id },
      include: {
        memberships: {
          include: {
            organization: true,
          },
        },
      },
    });

    if (!existingUser) {
      this.logger.log(`Creating new user for Auth0 ID: ${auth0Id}`);

      // Create user with personal organization, membership, and free subscription in a transaction
      const result = await this.prisma.$transaction(async (tx) => {
        // 1. Create user
        const newUser = await tx.user.create({
          data: {
            auth0Id,
            email,
          },
        });

        // 2. Create personal organization
        const organization = await tx.organization.create({
          data: {
            name: 'Personal Workspace',
          },
        });

        // 3. Create membership (user as OWNER)
        await tx.membership.create({
          data: {
            userId: newUser.id,
            orgId: organization.id,
            role: 'OWNER',
          },
        });

        // 4. Create FREE subscription
        await tx.subscription.create({
          data: {
            orgId: organization.id,
            plan: 'FREE',
            status: 'ACTIVE',
          },
        });

        return { user: newUser, organization };
      });

      this.logger.log(
        `User created with ID: ${result.user.id}, Organization: ${result.organization.id}`,
      );

      // Emit user created event
      this.eventBus.emit({
        eventType: 'user.created',
        timestamp: new Date(),
        userId: result.user.id,
        payload: {
          userId: result.user.id,
          auth0Id: result.user.auth0Id,
          email: result.user.email,
          organizationId: result.organization.id,
        },
      });

      return result.user;
    } else if (existingUser.email !== email) {
      this.logger.log(`Updating email for user ${existingUser.id}`);
      return this.prisma.user.update({
        where: { id: existingUser.id },
        data: { email },
      });
    }

    // Return existing user (without memberships relation to match return type)
    return {
      id: existingUser.id,
      auth0Id: existingUser.auth0Id,
      email: existingUser.email,
      createdAt: existingUser.createdAt,
      updatedAt: existingUser.updatedAt,
    };
  }

  async findUserByAuth0Id(auth0Id: string): Promise<User | null> {
    return this.prisma.user.findUnique({
      where: { auth0Id },
    });
  }

  async findUserById(id: string): Promise<User | null> {
    return this.prisma.user.findUnique({
      where: { id },
    });
  }

  async getUserWithOrganization(userId: string): Promise<Prisma.UserGetPayload<{
    include: {
      memberships: {
        include: {
          organization: {
            include: {
              subscription: true;
            };
          };
        };
      };
    };
  }> | null> {
    return this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        memberships: {
          include: {
            organization: {
              include: {
                subscription: true,
              },
            },
          },
          where: {
            role: 'OWNER', // Get the primary organization where user is owner
          },
          take: 1,
        },
      },
    });
  }
}
