import { Module } from '@nestjs/common';
import { PrismaBusinessModule } from '@libs/prisma-business';
import { UserRepository } from './infrastructure/repositories/user.repository';

@Module({
  imports: [PrismaBusinessModule],
  providers: [UserRepository],
  exports: [UserRepository],
})
export class UsersModule {}
