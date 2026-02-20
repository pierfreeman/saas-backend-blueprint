import { MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { RedisModule } from '../../redis/redis.module';
import { EventsModule } from '../../events/events.module';
import { RateLimitMiddleware } from './middleware/rate-limit.middleware';
import { BruteForceProtectionMiddleware } from './middleware/brute-force-protection.middleware';
import { PayloadSanitizationMiddleware } from './middleware/payload-sanitization.middleware';
import { RequestSizeLimitMiddleware } from './middleware/request-size-limit.middleware';
import { CsrfProtectionMiddleware } from './middleware/csrf-protection.middleware';
import { HeadersSecurityMiddleware } from './middleware/headers-security.middleware';
import { SuspiciousActivityGuard } from './guards/suspicious-activity.guard';
import { AttackDetectionService } from './services/attack-detection.service';
import { SecurityLoggerService } from './services/security-logger.service';

@Module({
  imports: [RedisModule, EventsModule],
  providers: [
    AttackDetectionService,
    SecurityLoggerService,
    HeadersSecurityMiddleware,
    RequestSizeLimitMiddleware,
    RateLimitMiddleware,
    PayloadSanitizationMiddleware,
    CsrfProtectionMiddleware,
    BruteForceProtectionMiddleware,
    {
      provide: APP_GUARD,
      useClass: SuspiciousActivityGuard,
    },
  ],
  exports: [AttackDetectionService, SecurityLoggerService],
})
export class SecurityModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(
        HeadersSecurityMiddleware,
        RequestSizeLimitMiddleware,
        RateLimitMiddleware,
        PayloadSanitizationMiddleware,
        CsrfProtectionMiddleware,
      )
      .forRoutes({ path: '*', method: RequestMethod.ALL });

    consumer
      .apply(BruteForceProtectionMiddleware)
      .forRoutes(
        { path: 'auth/login', method: RequestMethod.POST },
        { path: 'auth/signin', method: RequestMethod.POST },
        { path: 'auth/token', method: RequestMethod.POST },
      );
  }
}
