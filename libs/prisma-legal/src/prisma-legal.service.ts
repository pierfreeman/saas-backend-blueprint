import {
  Injectable,
  OnModuleInit,
  Logger,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/prisma/client.js';

/**
 * PrismaLegalService
 * Provides access to the legal audit PostgreSQL database.
 * This is a SEPARATE database from the business database.
 *
 * Design constraints:
 *  - NEVER issue UPDATE statements via this service.
 *  - NEVER issue DELETE statements via this service.
 *  - Records are append-only for ISO 27001 and GDPR accountability.
 *  - The application role in production must have INSERT-only permissions.
 *  - Records must survive organisation deletion.
 *  - No cleanDatabase() method — the legal DB is never wiped.
 *
 * Extends PrismaClient from the generated legal client.
 * This ensures no accidental cross-contamination with the business Prisma client.
 */
@Injectable()
export class PrismaLegalService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaLegalService.name);

  constructor(private readonly config: ConfigService) {
    const connectionString =
      config.get<string>('database.legalAuditUrl') ??
      process.env['LEGAL_AUDIT_DATABASE_URL'] ??
      '';
    const adapter = new PrismaPg({ connectionString });
    super({
      adapter,
      log: [
        { emit: 'event', level: 'error' },
        { emit: 'event', level: 'warn' },
      ],
    });
  }

  async onModuleInit() {
    this.logger.log('Connecting to legal audit database...');
    try {
      await this['$connect']();
      this.logger.log('PrismaLegalService connected successfully');
    } catch (error) {
      this.logger.error('Failed to connect to legal audit database', error);
      throw error;
    }
  }

  /**
   * Called automatically by NestJS when the process receives a shutdown signal
   * (SIGTERM, SIGINT, …) — requires app.enableShutdownHooks() in main.ts.
   */
  async onModuleDestroy() {
    this.logger.log('Disconnecting from legal audit database...');
    await this['$disconnect']();
  }
}
