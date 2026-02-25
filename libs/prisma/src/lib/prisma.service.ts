import {
  Injectable,
  OnModuleInit,
  INestApplication,
  Logger,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * Prisma Service
 * Provides database access and manages connection lifecycle
 *
 * TODO: Add query logging, middleware for tenant filtering
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
  private readonly logger = new Logger(PrismaService.name);

  async onModuleInit() {
    try {
      await this['$connect']();
      this.logger.log('Prisma Client connected successfully');
    } catch (error) {
      this.logger.error('Failed to connect to database', error);
      throw error;
    }
  }

  /**
   * Enable shutdown hooks to properly disconnect from database
   * Call this in main.ts to ensure graceful shutdown
   */
  async enableShutdownHooks(app: INestApplication) {
    process.on('beforeExit', async () => {
      this.logger.log('Database connection closing...');
      await this['$disconnect']();
      await app.close();
    });
  }
}
