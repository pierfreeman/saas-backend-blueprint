import { Module } from '@nestjs/common';
import { PrismaBusinessModule } from '@libs/prisma-business';
import { UserRepository } from './infrastructure/repositories/user.repository';
import { UserProvisioningService } from './application/services/user-provisioning.service';

@Module({
  imports: [PrismaBusinessModule],
  providers: [UserRepository, UserProvisioningService],
  exports: [UserRepository, UserProvisioningService],
})
export class UsersModule {}
