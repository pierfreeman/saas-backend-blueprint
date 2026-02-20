import { PrismaClient } from '@prisma/client';

/**
 * TestDatabase class provides a Prisma client for testing
 * Uses the DATABASE_URL from environment (no testcontainers for simplicity)
 */
export class TestDatabase {
  private prisma: PrismaClient | null = null;

  /**
   * Initializes Prisma client with test database
   */
  async start(): Promise<void> {
    console.log('Initializing test database...');

    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL not set in environment');
    }

    // Create Prisma client
    this.prisma = new PrismaClient({
      datasources: {
        db: {
          url: process.env.DATABASE_URL,
        },
      },
    });

    await this.prisma.$connect();

    // Clean database before tests
    await this.clean();

    console.log('Test database initialized');
  }

  /**
   * Disconnects Prisma client
   */
  async stop(): Promise<void> {
    if (this.prisma) {
      await this.prisma.$disconnect();
      this.prisma = null;
    }

    console.log('Test database connection closed');
  }

  /**
   * Gets the Prisma client
   */
  getPrisma(): PrismaClient {
    if (!this.prisma) {
      throw new Error('Prisma client not initialized. Call start() first.');
    }
    return this.prisma;
  }

  /**
   * Cleans all data from all tables (for test isolation)
   */
  async clean(): Promise<void> {
    if (!this.prisma) return;

    // Delete in order to respect foreign key constraints
    await this.prisma.auditEvent.deleteMany();
    await this.prisma.subscription.deleteMany();
    await this.prisma.player.deleteMany();
    await this.prisma.team.deleteMany();
    await this.prisma.membership.deleteMany();
    await this.prisma.organization.deleteMany();
    await this.prisma.user.deleteMany();
  }
}
