import { Module } from '@nestjs/common';
import { PrismaModule } from '@libs/prisma';
import { AuditModule } from '@libs/audit';
import { AuthModule } from '../auth/auth.module';
import { RBACModule } from '../rbac/rbac.module';
import { AuditController } from './audit.controller';

/**
 * App-level audit feature module.
 *
 * Wires the read-only AuditController (accessible only to OWNER / ADMIN
 * members) to the shared AuditModule library.
 */
@Module({
  imports: [PrismaModule, AuthModule, RBACModule, AuditModule],
  controllers: [AuditController],
})
export class AuditAppModule {}
