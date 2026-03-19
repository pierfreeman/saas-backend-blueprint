import { Module } from '@nestjs/common';
import { PrismaBusinessModule } from '@libs/prisma-business';
import { UserRepository } from './infrastructure/repositories/user.repository';
import { UsersService } from './application/services/users.service';

@Module({
  imports: [PrismaBusinessModule],
  providers: [UserRepository, UsersService],
  exports: [UsersService],
})
export class UsersModule {}
