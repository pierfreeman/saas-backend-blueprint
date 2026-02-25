/**
 * API bootstrap
 */

import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AllExceptionsFilter } from '@libs/common';
import { AppModule } from './app/app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

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
    .setTitle('API Documentation')
    .setDescription('API description')
    .setVersion('1.0')
    .addTag('Health', 'Health check endpoints')
    .addTag('Tasks', 'Task management endpoints')
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
