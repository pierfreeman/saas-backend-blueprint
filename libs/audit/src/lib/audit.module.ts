import { Module } from '@nestjs/common';
import { AuditService } from './audit.service';
import { PrismaModule } from '@libs/prisma';

/**
 * AuditModule
 *
 * Global-scoped NestJS library module providing compliance-grade audit logging.
 * Import this module in any feature module that needs to emit audit events.
 *
 * Example:
 *   @Module({ imports: [AuditModule], ... })
 *   export class OrganizationsModule {}
 */
@Module({
  imports: [PrismaModule],
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
