import {
  Injectable,
  OnModuleInit,
  Logger,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';

/**
 * PrismaBusinessService
 * Provides access to the business PostgreSQL database.
 * Manages the Prisma connection lifecycle for domain models:
 * User, Organization, Membership, ActivityLog, and Job.
 *
 * Extends PrismaClient directly so all generated model accessors
 * (e.g. this.user, this.organization, this.activityLog) are available on the service.
 *
 * For legal/compliance audit data use PrismaLegalService (@libs/prisma-legal).
 */
@Injectable()
export class PrismaBusinessService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaBusinessService.name);
  private readonly config: ConfigService;

  constructor(config: ConfigService) {
    super({
      datasources: {
        db: {
          url:
            config.get<string>('database.url') ?? process.env['DATABASE_URL'],
        },
      },
      log: [
        { emit: 'event', level: 'query' },
        { emit: 'event', level: 'error' },
        { emit: 'event', level: 'warn' },
      ],
    });
    this.config = config;
  }

  async onModuleInit() {
    this.logger.log('Connecting to business database...');
    try {
      await this['$connect']();
      this.logger.log('PrismaBusinessService connected successfully');
    } catch (error) {
      this.logger.error('Failed to connect to business database', error);
      throw error;
    }
  }

  /**
   * Called automatically by NestJS when the process receives a shutdown signal
   * (SIGTERM, SIGINT, …) — requires app.enableShutdownHooks() in main.ts.
   */
  async onModuleDestroy() {
    this.logger.log('Disconnecting from business database...');
    await this['$disconnect']();
  }

  /**
   * Deletes all rows from every model — for use in tests only.
   * Throws if called in production to prevent accidental data loss.
   */
  async cleanDatabase(): Promise<void> {
    if (this.config.get<string>('app.nodeEnv') === 'production') {
      throw new Error('Cannot clean database in production');
    }

    const models = Reflect.ownKeys(this).filter(
      (key) => typeof key === 'string' && key[0] !== '_' && key[0] !== '$',
    );

    await Promise.all(
      models.map((modelKey) => {
        const model = this[modelKey as keyof this] as {
          deleteMany?: () => Promise<unknown>;
        };
        return model.deleteMany ? model.deleteMany() : Promise.resolve();
      }),
    );
  }
}
