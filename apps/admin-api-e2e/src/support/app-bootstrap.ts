/**
 * app-bootstrap.ts — Creates and starts the admin-api NestJS application for integration testing.
 *
 * Mirrors the production bootstrap in apps/admin-api/src/main.ts with two differences:
 *  1. Does NOT call app.listen() — supertest creates an HTTP server internally.
 *  2. Returns the app instance so tests can access DI providers directly.
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import {
  ObservabilityExceptionFilter,
  ObservabilityLoggerService,
  RequestLoggingInterceptor,
  SentryInterceptor,
} from '@libs/observability';
// E2e bootstrapping: importing the app module for NestFactory.create() is intentional.
// eslint-disable-next-line @nx/enforce-module-boundaries
import { AdminApiAppModule } from '@apps/admin-api/app/app.module';

export async function bootstrapTestApp(): Promise<INestApplication> {
  const app = await NestFactory.create(AdminApiAppModule, {
    logger: ['error', 'warn'],
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  app.useLogger(app.get(ObservabilityLoggerService));
  app.useGlobalFilters(app.get(ObservabilityExceptionFilter));
  app.useGlobalInterceptors(
    app.get(RequestLoggingInterceptor),
    app.get(SentryInterceptor),
  );

  await app.init();

  return app;
}
