import { Injectable, Logger } from '@nestjs/common';
import { PrismaBusinessService } from '@libs/prisma-business';
import { User } from '@prisma/client';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(private readonly prisma: PrismaBusinessService) {}

  /**
   * Syncs an Auth0 user to the local database.
   * Creates the user if they do not exist, or updates the email if it changed.
   */
  async syncUser(auth0Id: string, email: string): Promise<User> {
    const existingUser = await this.prisma.user.findUnique({
      where: { auth0Id },
    });

    if (!existingUser) {
      this.logger.log(`Creating new user for Auth0 ID: ${auth0Id}`);
      const newUser = await this.prisma.user.create({
        data: { auth0Id, email },
      });
      this.logger.log(`User created with ID: ${newUser.id}`);
      return newUser;
    }

    if (existingUser.email !== email) {
      this.logger.log(`Updating email for user ${existingUser.id}`);
      return this.prisma.user.update({
        where: { id: existingUser.id },
        data: { email },
      });
    }

    return existingUser;
  }

  async findUserByAuth0Id(auth0Id: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { auth0Id } });
  }

  async findUserById(id: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { id } });
  }
}
