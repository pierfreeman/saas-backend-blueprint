/**
 * Admin API bootstrap
 *
 * Sentry MUST be initialised before NestFactory.create() so that its
 * async-context tracking is active from the very first import.
 */

// ── Sentry initialisation (must be first) ────────────────────────────────────
import * as Sentry from '@sentry/node';

Sentry.init({
  dsn: process.env['SENTRY_DSN'] ?? '',
  enabled:
    process.env['SENTRY_ENABLED'] !== 'false' &&
    process.env['NODE_ENV'] !== 'test',
  environment: process.env['NODE_ENV'] ?? 'development',
  release: process.env['APP_VERSION'] ?? 'unknown',
  tracesSampleRate: Number.parseFloat(
    process.env['SENTRY_TRACES_SAMPLE_RATE'] ?? '0.1',
  ),
  enableLogs: true,
});
// ─────────────────────────────────────────────────────────────────────────────

import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import {
  ObservabilityLoggerService,
  ObservabilityExceptionFilter,
  RequestLoggingInterceptor,
  SentryInterceptor,
} from '@libs/observability';
import {
  RateLimitInterceptor,
  SecurityAuditInterceptor,
  CsrfInterceptor,
} from '@libs/security';
import helmet from 'helmet';
import { AdminApiAppModule } from './app/app.module';

const app = await NestFactory.create(AdminApiAppModule);

const configService = app.get(ConfigService);

// ── Security Headers (Helmet) ────────────────────────────────────────────────
const isProduction = configService.get<string>('app.nodeEnv') === 'production';
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        upgradeInsecureRequests: isProduction ? [] : null,
      },
    },
    strictTransportSecurity: isProduction
      ? { maxAge: 31536000, includeSubDomains: true, preload: true }
      : false,
    xContentTypeOptions: true,
    frameguard: { action: 'deny' },
    xXssProtection: false,
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    crossOriginEmbedderPolicy: true,
    crossOriginOpenerPolicy: { policy: 'same-origin' },
    crossOriginResourcePolicy: { policy: 'same-origin' },
    hidePoweredBy: true,
    dnsPrefetchControl: { allow: false },
    ieNoOpen: true,
  }),
);

// ── CORS ─────────────────────────────────────────────────────────────────────
const rawOrigins = configService.get<string>('security.cors.allowedOrigins');
let allowedOrigins: string[];
if (Array.isArray(rawOrigins)) {
  allowedOrigins = rawOrigins;
} else if (typeof rawOrigins === 'string' && rawOrigins) {
  allowedOrigins = rawOrigins
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
} else {
  allowedOrigins = [];
}

app.enableCors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (allowedOrigins.length === 0 && !isProduction) {
      return callback(null, true);
    }
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    Logger.warn(`CORS: blocked request from origin: ${origin}`, 'AdminApi');
    return callback(new Error('Not allowed by CORS'), false);
  },
  credentials: configService.get<boolean>('security.cors.credentials') ?? true,
  methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'x-csrf-token',
    'ngrok-skip-browser-warning',
  ],
  maxAge: 86400,
});

// ── Global validation pipe ───────────────────────────────────────────────────
app.useGlobalPipes(
  new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    transformOptions: { enableImplicitConversion: true },
  }),
);

// ── App logger ───────────────────────────────────────────────────────────────
app.useLogger(app.get(ObservabilityLoggerService));

// ── Global exception filter ──────────────────────────────────────────────────
app.useGlobalFilters(app.get(ObservabilityExceptionFilter));

// ── Global interceptors ──────────────────────────────────────────────────────
app.useGlobalInterceptors(
  app.get(RequestLoggingInterceptor),
  app.get(SentryInterceptor),
  app.get(RateLimitInterceptor),
  app.get(CsrfInterceptor),
  app.get(SecurityAuditInterceptor),
);

// ── Swagger ──────────────────────────────────────────────────────────────────
const swaggerConfig = new DocumentBuilder()
  .setTitle('SaaS Admin API')
  .setDescription(
    '## Overview\n' +
      'Admin backoffice REST API — requires system-admin access.\n\n' +
      '### Authentication\n' +
      'All endpoints require a valid **Auth0 JWT** with `isSystemAdmin: true`.\n\n' +
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
      description: 'Enter Auth0 JWT token (system admin required)',
      in: 'header',
    },
    'JWT-auth',
  )
  .addTag('Admin', 'System administration endpoints')
  .build();

const document = SwaggerModule.createDocument(app, swaggerConfig);
SwaggerModule.setup('docs', app, document);

// ── Shutdown hooks ────────────────────────────────────────────────────────────
app.enableShutdownHooks();

const port = Number.parseInt(
  process.env['ADMIN_API_PORT'] ?? process.env['PORT'] ?? '3001',
  10,
);
await app.listen(port);

const logger = app.get(ObservabilityLoggerService);
logger.logCtx(
  `Admin API running on http://localhost:${port}`,
  { path: `/`, method: 'BOOT' },
  'Bootstrap',
);
logger.logCtx(`Swagger:  http://localhost:${port}/docs`, {}, 'Bootstrap');
