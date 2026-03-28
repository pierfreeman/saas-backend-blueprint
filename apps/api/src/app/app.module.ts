import { ActivityLogModule } from '@libs/activity-log';
import { TenantMiddleware } from '@libs/common';
import { ConfigModule } from '@libs/config';
import { EventsModule } from '@libs/events';
import { LegalAuditModule } from '@libs/legal-audit';
import { ObservabilityModule } from '@libs/observability';
import { PrismaBusinessModule } from '@libs/prisma-business';
import { RedisModule } from '@libs/redis';
import {
  PayloadSanitizationMiddleware,
  RequestSizeLimitMiddleware,
  SecurityModule,
} from '@libs/security';
import {
  MiddlewareConsumer,
  Module,
  NestModule,
  RequestMethod,
} from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { ActivityLogAppModule } from './activity-log/activity-log-app.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { BillingAppModule } from './billing/billing-app.module';
import { FeatureFlagsModule } from './feature-flags/feature-flags.module';
import { HealthModule } from './health/health.module';
import { MembershipsModule } from './memberships/memberships.module';
import { NotificationsAppModule } from './notifications/notifications-app.module';
import { OrganizationsModule } from './organizations/organizations.module';
import { RBACModule } from '@libs/rbac';
import { StorageAppModule } from './storage/storage-app.module';
import { TasksModule } from './tasks/tasks.module';
import { PlanningAppModule } from './planning/planning-app.module';

@Module({
  imports: [
    ConfigModule,
    ScheduleModule.forRoot(),
    ObservabilityModule,
    PrismaBusinessModule,
    RedisModule,
    EventsModule,
    ActivityLogModule,
    LegalAuditModule,
    SecurityModule,
    AuthModule,
    OrganizationsModule,
    MembershipsModule,
    RBACModule,
    HealthModule,
    TasksModule,
    ActivityLogAppModule,
    BillingAppModule,
    FeatureFlagsModule,
    NotificationsAppModule,
    StorageAppModule,
    PlanningAppModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      // 1. Reject oversized payloads before body is parsed (fast path)
      .apply(RequestSizeLimitMiddleware)
      .forRoutes({ path: '*', method: RequestMethod.ALL });

    consumer
      // 2. Sanitize SQL/NoSQL/XSS patterns in body, query, params
      .apply(PayloadSanitizationMiddleware)
      .forRoutes({ path: '*', method: RequestMethod.ALL });

    consumer
      // 3. Resolve tenant context from JWT/header (business logic)
      .apply(TenantMiddleware)
      .forRoutes({ path: '*', method: RequestMethod.ALL });
  }
}
