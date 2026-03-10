import { ActivityLogModule } from '@libs/activity-log';
import { EventsModule } from '@libs/events';
import { PrismaBusinessModule } from '@libs/prisma-business';
import { Module } from '@nestjs/common';
import { RBACModule } from '../rbac/rbac.module';
import { DataExportsController } from './data-exports.controller';
import { DataExportsService } from './data-exports.service';

@Module({
  imports: [PrismaBusinessModule, EventsModule, ActivityLogModule, RBACModule],
  controllers: [DataExportsController],
  providers: [DataExportsService],
  exports: [DataExportsService],
})
export class DataExportsModule {}
