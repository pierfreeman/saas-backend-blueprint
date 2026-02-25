import { Module } from '@nestjs/common';
import { PrismaModule } from '@libs/prisma';
import { MembershipsService } from './memberships.service';
import { MembershipsController } from './memberships.controller';

@Module({
  imports: [PrismaModule],
  controllers: [MembershipsController],
  providers: [MembershipsService],
  exports: [MembershipsService],
})
export class MembershipsModule {}
