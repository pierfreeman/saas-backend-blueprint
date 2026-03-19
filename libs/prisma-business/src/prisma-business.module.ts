import { Module } from '@nestjs/common';
import { PrismaBusinessService } from './prisma-business.service';

@Module({
  providers: [PrismaBusinessService],
  exports: [PrismaBusinessService],
})
export class PrismaBusinessModule {}
