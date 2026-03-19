import { Module } from '@nestjs/common';
import { ActivityLogModule } from '@libs/activity-log';
import { AuthModule } from '../auth/auth.module';
import { RBACModule } from '@libs/rbac';
import { ActivityLogController } from './activity-log.controller';

@Module({
  imports: [ActivityLogModule, AuthModule, RBACModule],
  controllers: [ActivityLogController],
})
export class ActivityLogAppModule {}
