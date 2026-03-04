import { Module } from '@nestjs/common';
import { LegalAuditService } from './legal-audit.service';
import { PrismaLegalModule } from '@libs/prisma-legal';

/**
 * LegalAuditModule
 *
 * NestJS library module providing immutable compliance event recording.
 * Writes to a separate PostgreSQL database via PrismaLegalService.
 *
 * Import in any feature module that needs to emit compliance events:
 *   @Module({ imports: [LegalAuditModule], ... })
 *   export class OrganizationsModule {}
 *
 * This module does NOT depend on ActivityLogModule — they are fully independent.
 * LegalAuditService exposes NO read/query methods — write-only by design.
 */
@Module({
  imports: [PrismaLegalModule],
  providers: [LegalAuditService],
  exports: [LegalAuditService],
})
export class LegalAuditModule {}
