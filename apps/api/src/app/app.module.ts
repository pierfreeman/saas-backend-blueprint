import { PrismaModule } from '@libs/prisma';
import { RedisModule } from '@libs/redis';
import { ConfigModule } from '@libs/config';
import { AuditModule } from '@libs/audit';
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
import { AuditAppModule } from './audit/audit-app.module';
import { TenantMiddleware } from '@libs/common';

@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    RedisModule,
    EventsModule,
    AuditModule,
    AuthModule,
    OrganizationsModule,
    MembershipsModule,
    RBACModule,
    HealthModule,
    TasksModule,
    AuditAppModule,
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
