import { Module } from '@nestjs/common';
import { PrismaModule } from '@libs/prisma';
import { OrganizationsService } from './organizations.service';
import { OrganizationsController } from './organizations.controller';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [OrganizationsController],
  providers: [OrganizationsService],
  exports: [OrganizationsService],
})
export class OrganizationsModule {}
