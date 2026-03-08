/**
 * API bootstrap
 */

import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { AllExceptionsFilter } from '@libs/common';
import { AsyncApiDocumentBuilder, AsyncApiModule } from 'nestjs-asyncapi';
import { AppModule } from './app/app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    // rawBody: true exposes request.rawBody (Buffer) on all routes.
    // Required by WebhookController to verify Stripe HMAC signatures.
    rawBody: true,
  });

  // ── WebSocket adapter ───────────────────────────────────────────────────────
  // Required to enable socket.io-based WebSocket gateways (e.g. JobsGateway).
  app.useWebSocketAdapter(new IoAdapter(app));

  // ── Global validation pipe ──────────────────────────────────────────────────
  // whitelist: strips unknown properties from DTOs
  // forbidNonWhitelisted: throws 400 if unknown properties are sent
  // transform: auto-converts plain objects to DTO class instances
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  // ── Global exception filter ─────────────────────────────────────────────────
  // Returns a consistent { statusCode, timestamp, path, method, message } shape
  app.useGlobalFilters(new AllExceptionsFilter());

  // ── Swagger ──────────────────────────────────────────────────────────────────
  const config = new DocumentBuilder()
    .setTitle('SaaS Backend API')
    .setDescription(
      '## Overview\n' +
        'REST API for the saas-backend multi-tenant SaaS backend.\n\n' +
        '### Authentication\n' +
        'All protected endpoints require a valid **Auth0 JWT** ' +
        '(`Authorization: Bearer <token>`).\n\n' +
        '### Multi-tenancy\n' +
        'Organization-scoped endpoints are nested under `/organizations/:orgId/`. ' +
        'The caller must be a member of the target organization.\n\n' +
        '### Permissions (RBAC)\n' +
        '| Role | Capabilities |\n' +
        '|------|--------------|\n' +
        '| OWNER | Full control |\n' +
        '| ADMIN | Manage members, read audit |\n' +
        '| MEMBER | Standard access |\n' +
        '| READ_ONLY | Read-only access |\n\n' +
        '### Error format\n' +
        'All errors follow the shape `{ statusCode, timestamp, path, method, message }`.',
    )
    .setVersion('1.0')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        name: 'Authorization',
        description: 'Enter Auth0 JWT token',
        in: 'header',
      },
      'JWT-auth',
    )
    .addTag('Authentication', 'Authentication endpoints')
    .addTag('Health', 'Health check endpoints')
    .addTag('Organizations', 'Organization management endpoints')
    .addTag('Memberships', 'Organization membership management endpoints')
    .addTag(
      'Feature Flags',
      'Organization feature flag and entitlement endpoints',
    )
    .addTag('Activity Log', 'Activity log query endpoints')
    .addTag('Billing', 'Subscription and billing management endpoints')
    .addTag('Notifications', 'In-app notification management endpoints')
    .addTag('Tasks', 'Task management and job status endpoints')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, document);

  // ── AsyncAPI ──────────────────────────────────────────────────────────────────
  // Generates an AsyncAPI 2.x specification for the `/notifications` Socket.IO
  // namespace and serves an interactive explorer at /asyncapi.
  const asyncApiConfig = new AsyncApiDocumentBuilder()
    .setTitle('SaaS Backend — Notifications WebSocket')
    .setContact(
      'SaaS Backend',
      'https://github.com/pierfreeman/saas-backend-blueprint',
      'noreply@example.com',
    )
    .setLicense('MIT', 'https://opensource.org/licenses/MIT')
    .setDescription(
      '## Overview\n' +
        'AsyncAPI 2.x specification for the real-time `/notifications` Socket.IO namespace.\n\n' +
        '### Authentication\n' +
        'Pass the Auth0 JWT bearer token in one of three ways (checked in order):\n' +
        '1. **Auth option** — `io(url, { auth: { token: "Bearer <jwt>" } })` *(recommended)*\n' +
        '2. **Query string** — `?token=Bearer%20<jwt>`\n' +
        '3. **Authorization header** — `Authorization: Bearer <jwt>` *(non-browser only)*\n\n' +
        '### Rooms\n' +
        'On successful connection the gateway automatically joins each socket to:\n' +
        '- `user:<userId>` — personal room for direct delivery.\n' +
        '- `org:<orgId>` — one room per active organisation membership.\n\n' +
        '### Channel directions\n' +
        '| Direction | Channels |\n' +
        '|-----------|---------|\n' +
        '| Server → Client (subscribe) | `notification:new`, `notification:unread-count`, `notification:list` |\n' +
        '| Client → Server (publish) | `notification:get-all`, `notification:mark-read`, `notification:mark-all-read` |',
    )
    .setVersion('1.0')
    .setDefaultContentType('application/json')
    .addBearerAuth()
    .addServer('notifications-ws', {
      url: 'ws://localhost:3000',
      protocol: 'socket.io',
      description: 'Local development — Socket.IO `/notifications` namespace',
    })
    .build();

  const asyncApiDocument = await AsyncApiModule.createDocument(
    app,
    asyncApiConfig,
  );
  await AsyncApiModule.setup('asyncapi', app, asyncApiDocument);

  // ── Shutdown hooks ───────────────────────────────────────────────────────────
  app.enableShutdownHooks();

  const configService = app.get(ConfigService);
  const port = configService.get<number>('app.port') ?? 3000;
  await app.listen(port);
  Logger.log(`🚀 Application is running on: http://localhost:${port}`);
  Logger.log(`📖 Swagger (REST):   http://localhost:${port}/docs`);
  Logger.log(`📡 AsyncAPI (WebSocket): http://localhost:${port}/asyncapi`);
}

bootstrap();
