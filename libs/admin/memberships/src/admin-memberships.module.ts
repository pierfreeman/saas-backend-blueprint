import { Module } from '@nestjs/common';
import { PrismaBusinessModule } from '@libs/prisma-business';
import { MembershipsModule } from '@libs/memberships';
import { AdminMembershipsRepository } from './infrastructure/repositories/admin-memberships.repository';
import { AdminMembershipsService } from './application/services/admin-memberships.service';

@Module({
  imports: [PrismaBusinessModule, MembershipsModule],
  providers: [AdminMembershipsRepository, AdminMembershipsService],
  exports: [AdminMembershipsService],
})
export class AdminMembershipsModule {}
