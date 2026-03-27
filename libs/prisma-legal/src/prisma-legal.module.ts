import { Module } from '@nestjs/common';
import { PrismaLegalService } from './prisma-legal.service';

@Module({
  providers: [PrismaLegalService],
  exports: [PrismaLegalService],
})
export class PrismaLegalModule {}
