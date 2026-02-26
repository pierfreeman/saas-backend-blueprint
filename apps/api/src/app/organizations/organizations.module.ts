import { Module } from '@nestjs/common';
import { PrismaModule } from '@libs/prisma';
import { TenantModule } from '@libs/common';
import { AuditModule } from '@libs/audit';
import { OrganizationsService } from './organizations.service';
import { OrganizationsController } from './organizations.controller';
import { AuthModule } from '../auth/auth.module';
import { RBACModule } from '../rbac/rbac.module';

@Module({
  imports: [PrismaModule, AuthModule, RBACModule, TenantModule, AuditModule],
  controllers: [OrganizationsController],
  providers: [OrganizationsService],
  exports: [OrganizationsService],
})
export class OrganizationsModule {}
