import { ActivityLogModule } from '@libs/activity-log';
import { Auth0Module } from '@libs/auth0';
import { TenantMiddleware } from '@libs/common';
import { ConfigModule } from '@libs/config';
import { LegalAuditModule } from '@libs/legal-audit';
import { ObservabilityModule } from '@libs/observability';
import { PrismaBusinessModule } from '@libs/prisma-business';
import { PrismaLegalModule } from '@libs/prisma-legal';
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
import { AdminModule } from './admin/admin.module';

@Module({
  imports: [
    ConfigModule,
    ObservabilityModule,
    PrismaBusinessModule,
    PrismaLegalModule,
    RedisModule,
    ActivityLogModule,
    LegalAuditModule,
    SecurityModule,
    Auth0Module,
    AdminModule,
  ],
})
export class AdminApiAppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(RequestSizeLimitMiddleware)
      .forRoutes({ path: '*', method: RequestMethod.ALL });

    consumer
      .apply(PayloadSanitizationMiddleware)
      .forRoutes({ path: '*', method: RequestMethod.ALL });

    consumer
      .apply(TenantMiddleware)
      .forRoutes({ path: '*', method: RequestMethod.ALL });
  }
}
