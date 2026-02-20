import { Module } from '@nestjs/common';
import { ConfigModule } from './config/config.module';
import { ConfigService } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { EventsModule } from './events/events.module';
import { AuthModule } from './modules/auth/auth.module';
import { OrganizationsModule } from './modules/organizations/organizations.module';
import { MembershipsModule } from './modules/memberships/memberships.module';
import { RBACModule } from './modules/rbac/rbac.module';
import { TeamsModule } from './modules/teams/teams.module';
import { PlayersModule } from './modules/players/players.module';
import { BillingModule } from './modules/billing/billing.module';
import { SubscriptionsModule } from './modules/subscriptions/subscriptions.module';
import { FeatureFlagsModule } from './modules/feature-flags/feature-flags.module';
import { AuditModule } from './modules/audit/audit.module';
import { AdminModule } from './modules/admin/admin.module';
import { HealthModule } from './modules/health/health.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { StorageModule } from './modules/storage/storage.module';
import { SecurityModule } from './modules/security/security.module';
import { ObservabilityModule } from './observability/observability.module';
import { RedisThrottlerStorage } from './common/throttler/redis-throttler-storage.service';
import { RedisService } from './redis/redis.service';
import { AppController } from './app.controller';
import { AppService } from './app.service';

@Module({
  imports: [
    ConfigModule,
    ObservabilityModule, // Add observability module early
    ScheduleModule.forRoot(), // Required for cron jobs (storage cleanup)
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        throttlers: [
          {
            ttl: configService.get<number>('THROTTLE_TTL')!,
            limit: configService.get<number>('THROTTLE_LIMIT')!,
          },
        ],
      }),
    }),
    PrismaModule,
    RedisModule,
    EventsModule,
    AuthModule,
    OrganizationsModule,
    MembershipsModule,
    RBACModule,
    TeamsModule,
    PlayersModule,
    BillingModule,
    SubscriptionsModule,
    FeatureFlagsModule,
    AuditModule,
    AdminModule,
    HealthModule,
    NotificationsModule,
    StorageModule, // Enterprise file storage module
    SecurityModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: 'THROTTLER_STORAGE',
      useFactory: (redisService: RedisService) => {
        return new RedisThrottlerStorage(redisService);
      },
      inject: [RedisService],
    },
  ],
})
export class AppModule {}
