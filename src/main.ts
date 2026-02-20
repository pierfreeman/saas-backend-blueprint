import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { LoggingInterceptor } from './config/logging.interceptor';
import { ErrorMappingInterceptor } from './common/interceptors/error-mapping.interceptor';
import { SecurityExceptionsFilter } from './modules/security/filters/security-exceptions.filter';
import { SecurityLoggerService } from './modules/security/services/security-logger.service';
import {
  SentryInitService,
  DatadogInitService,
  SentryInterceptor,
  APP_LOGGER,
  IAppLogger,
} from './observability';

async function bootstrap() {
  const logger = new Logger('Bootstrap');

  const app = await NestFactory.create(AppModule, {
    rawBody: true, // Enable raw body for Stripe webhook
  });

  const configService = app.get(ConfigService);

  // Initialize Observability Providers
  // IMPORTANT: Datadog must be initialized before app creation for proper instrumentation
  // For now, we initialize after app creation, but in production this should happen before
  logger.log('Initializing observability providers...');
  SentryInitService.init(configService);
  DatadogInitService.init(configService);

  // Get the app logger instance
  const appLogger = app.get<IAppLogger>(APP_LOGGER);

  // Override NestJS logger with our custom logger
  // This makes all internal NestJS logs use our observability system
  app.useLogger({
    log: (message: string, context?: string) => appLogger.log(message, context),
    error: (message: string, trace?: string, context?: string) =>
      appLogger.error(message, trace, context),
    warn: (message: string, context?: string) => appLogger.warn(message, context),
    debug: (message: string, context?: string) => appLogger.debug(message, context),
    verbose: (message: string, context?: string) => appLogger.verbose(message, context),
  } as any);

  logger.log('Observability providers initialized');

  // CORS configuration
  const corsOrigin = configService.get<string>('CORS_ORIGIN');
  app.enableCors({
    origin: corsOrigin === '*' ? '*' : corsOrigin!.split(','),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  // Global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  // Global exception filter
  const securityLogger = app.get(SecurityLoggerService);
  app.useGlobalFilters(new SecurityExceptionsFilter(securityLogger), new AllExceptionsFilter());

  // Global interceptors
  app.useGlobalInterceptors(
    new LoggingInterceptor(),
    new ErrorMappingInterceptor(),
    new SentryInterceptor(), // Add Sentry performance tracking
  );

  // Swagger API Documentation
  const config = new DocumentBuilder()
    .setTitle('Multi-tenant SaaS Backend Blueprint API')
    .setDescription('Multi-tenant SaaS backend blueprint built with NestJS, Prisma, and PostgreSQL. Provides a scalable and secure foundation for building SaaS applications with features like authentication, authorization, tenant management, and more.')
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
    .addTag('Authentication', 'Auth0 authentication endpoints')
    .addTag('Organizations', 'Organization management')
    .addTag('Teams', 'Team management within organizations')
    .addTag('Players', 'Player management within teams')
    .addTag('Memberships', 'User membership in organizations')
    .addTag('Subscriptions', 'Subscription and plan management')
    .addTag('Billing', 'Stripe billing and payments')
    .addTag('Feature Flags', 'Feature flags and entitlements')
    .addTag('Audit', 'Audit log and event tracking')
    .addTag('Admin', 'Admin operations (super admin only)')
    .addTag('Health', 'Health check endpoints')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, document, {
    swaggerOptions: {
      persistAuthorization: true,
      tagsSorter: 'alpha',
      operationsSorter: 'alpha',
    },
  });

  const port = configService.get<number>('PORT') || 3000;
  await app.listen(port);

  logger.log(`Application is running on: http://localhost:${port}`);
  logger.log(`API Documentation (Swagger): http://localhost:${port}/docs`);
  logger.log(`Environment: ${configService.get<string>('NODE_ENV')}`);
  logger.log(`CORS enabled for: ${corsOrigin}`);

  // Log observability configuration
  const appEnv = configService.get<string>('APP_ENV', 'local');
  const logProvider = configService.get<string>('LOG_PROVIDER', 'nest');
  logger.log(`Observability: env=${appEnv}, provider=${logProvider}`);
}

void bootstrap();
