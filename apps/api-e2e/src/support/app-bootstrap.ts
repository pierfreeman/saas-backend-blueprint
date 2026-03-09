/**
 * app-bootstrap.ts — Creates and starts the NestJS test application.
 *
 * Mirrors the production bootstrap in apps/api/src/main.ts with two differences:
 *  1. Does NOT call app.listen() — supertest creates an HTTP server internally.
 *  2. Returns the app instance so tests can access DI providers directly
 *     (e.g. `app.get(PrismaBusinessService)`).
 *
 * Environment: load-env.ts (loaded via Jest setupFiles) has already set the
 * test environment variables before this function is called.
 *
 * Usage (in beforeAll):
 *   let app: INestApplication;
 *   let agent: supertest.SuperAgentTest;
 *
 *   beforeAll(async () => {
 *     setupNockAuth();                          // intercept JWKS before bootstrap
 *     app = await bootstrapTestApp();
 *     agent = supertest.agent(app.getHttpServer());
 *   });
 *
 *   afterAll(async () => {
 *     await app.close();
 *     teardownNockAuth();
 *   });
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { IoAdapter } from '@nestjs/platform-socket.io';
import {
  ObservabilityExceptionFilter,
  ObservabilityLoggerService,
  RequestLoggingInterceptor,
  SentryInterceptor,
} from '@libs/observability';
// E2e bootstrapping: importing the app module for NestFactory.create() is intentional.
// eslint-disable-next-line @nx/enforce-module-boundaries
import { AppModule } from '@apps/api/app/app.module';

/**
 * Bootstraps the full NestJS application for integration testing.
 * Returns the app ready to accept supertest requests.
 */
export async function bootstrapTestApp(): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn'], // reduce noise in test output
    rawBody: true, // required for Stripe webhook signature verification
  });

  // Mirrors production bootstrap (main.ts)
  app.useWebSocketAdapter(new IoAdapter(app));

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  // Observability: structured logging + Sentry filter (mirrors main.ts)
  app.useLogger(app.get(ObservabilityLoggerService));
  app.useGlobalFilters(app.get(ObservabilityExceptionFilter));
  app.useGlobalInterceptors(
    app.get(RequestLoggingInterceptor),
    app.get(SentryInterceptor),
  );

  // Init without listening — supertest provides its own HTTP server
  await app.init();

  return app;
}
