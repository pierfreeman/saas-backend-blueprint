import { PrismaBusinessModule } from '@libs/prisma-business';
import { RedisModule } from '@libs/redis';
import { ConfigModule } from '@libs/config';
import { ActivityLogModule } from '@libs/activity-log';
import { LegalAuditModule } from '@libs/legal-audit';
import { EventsModule } from '@libs/events';
import {
  MiddlewareConsumer,
  Module,
  NestModule,
  RequestMethod,
} from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { HealthModule } from './health/health.module';
import { MembershipsModule } from './memberships/memberships.module';
import { OrganizationsModule } from './organizations/organizations.module';
import { RBACModule } from './rbac/rbac.module';
import { TasksModule } from './tasks/tasks.module';
import { ActivityLogAppModule } from './activity-log/activity-log-app.module';
import { TenantMiddleware } from '@libs/common';

@Module({
  imports: [
    ConfigModule,
    PrismaBusinessModule,
    RedisModule,
    EventsModule,
    ActivityLogModule,
    LegalAuditModule,
    AuthModule,
    OrganizationsModule,
    MembershipsModule,
    RBACModule,
    HealthModule,
    TasksModule,
    ActivityLogAppModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(TenantMiddleware)
      .forRoutes({ path: '*', method: RequestMethod.ALL });
  }
}
