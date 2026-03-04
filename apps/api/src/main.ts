/**
 * API bootstrap
 */

import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { AllExceptionsFilter } from '@libs/common';
import { AppModule } from './app/app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

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
    .addTag('Tasks', 'Task management and job status endpoints')
    .addTag('Activity Log', 'Activity log query endpoints')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, document);

  // ── Shutdown hooks ───────────────────────────────────────────────────────────
  app.enableShutdownHooks();

  const configService = app.get(ConfigService);
  const port = configService.get<number>('app.port') ?? 3000;
  await app.listen(port);
  Logger.log(`🚀 Application is running on: http://localhost:${port}`);
}

bootstrap();
