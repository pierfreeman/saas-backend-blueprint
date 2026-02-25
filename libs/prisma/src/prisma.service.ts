import {
  Injectable,
  OnModuleInit,
  Logger,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';

/**
 * Prisma Service
 * Provides database access and manages the connection lifecycle.
 *
 * Extends PrismaClient directly so all generated model accessors
 * (e.g. this.user, this.organization) are available on the service.
 *
 * TODO: Add Prisma middleware for tenant filtering / soft-delete
 */
@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);
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
    // Store after super() — required because super() must be the first statement
    // in a constructor that extends a class with private/initialized fields.
    this.config = config;
  }

  async onModuleInit() {
    this.logger.log('Connecting to database...');
    try {
      await this['$connect']();
      this.logger.log('Prisma Client connected successfully');
    } catch (error) {
      this.logger.error('Failed to connect to database', error);
      throw error;
    }
  }

  /**
   * Called automatically by NestJS when the process receives a shutdown signal
   * (SIGTERM, SIGINT, …) — requires app.enableShutdownHooks() in main.ts.
   */
  async onModuleDestroy() {
    this.logger.log('Disconnecting from database...');
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
