import * as Joi from 'joi';

export const envValidationSchema = Joi.object({
  // Application
  NODE_ENV: Joi.string().valid('development', 'production', 'test').default('development'),
  PORT: Joi.number().default(3000),

  // Database
  DATABASE_URL: Joi.string().required(),

  // Redis
  REDIS_HOST: Joi.string().required(),
  REDIS_PORT: Joi.number().default(6379),
  REDIS_PASSWORD: Joi.string().allow('').optional(),

  // Auth0
  AUTH0_DOMAIN: Joi.string().required(),
  AUTH0_AUDIENCE: Joi.string().required(),

  // Stripe
  STRIPE_SECRET_KEY: Joi.string().required(),
  STRIPE_WEBHOOK_SECRET: Joi.string().required(),
  STRIPE_PRICE_ID_PRO: Joi.string().required(),
  STRIPE_PRICE_ID_ENTERPRISE: Joi.string().required(),

  // Frontend
  FRONTEND_URL: Joi.string().default('http://localhost:4200'),

  // Feature Flags
  FEATURE_FLAGS_CACHE_TTL: Joi.number().default(600),

  // Admin
  SUPER_ADMIN_EMAILS: Joi.string().required(),

  // Rate Limiting
  THROTTLE_TTL: Joi.number().default(60),
  THROTTLE_LIMIT: Joi.number().default(100),
  RATE_LIMIT_REQUESTS: Joi.number().default(100),
  RATE_LIMIT_WINDOW_MS: Joi.number().default(60000),
  RATE_LIMIT_BURST: Joi.number().default(20),

  // Security Middleware Layer
  BRUTE_FORCE_MAX_ATTEMPTS: Joi.number().default(5),
  BRUTE_FORCE_BLOCK_MS: Joi.number().default(900000),
  MAX_BODY_SIZE: Joi.string().default('2MB'),
  SECURITY_HEADERS_ENABLED: Joi.boolean().default(true),
  CSRF_PROTECTION_ENABLED: Joi.boolean().default(true),
  SECURITY_AUTO_THROTTLE_ENABLED: Joi.boolean().default(true),
  SUSPICIOUS_SCORE_THRESHOLD: Joi.number().default(20),

  // CORS
  CORS_ORIGIN: Joi.string().default('*'),

  // Observability / Logging
  APP_ENV: Joi.string().valid('local', 'dev', 'staging', 'prod').default('local'),
  LOG_PROVIDER: Joi.string().valid('nest', 'sentry', 'datadog').default('nest'),
  LOG_LEVEL: Joi.string().valid('debug', 'log', 'warn', 'error').default('debug'),

  // Sentry (optional)
  SENTRY_DSN: Joi.string().allow('').optional(),
  SENTRY_ENVIRONMENT: Joi.string().allow('').optional(),
  SENTRY_RELEASE: Joi.string().allow('').optional(),
  SENTRY_TRACES_SAMPLE_RATE: Joi.number().min(0).max(1).default(0.1),
  SENTRY_PROFILES_SAMPLE_RATE: Joi.number().min(0).max(1).default(0.1),

  // Datadog (optional)
  DATADOG_API_KEY: Joi.string().allow('').optional(),
  DATADOG_SERVICE: Joi.string().default('sports-intelligence-backend'),
  DATADOG_ENV: Joi.string().allow('').optional(),
  DATADOG_VERSION: Joi.string().allow('').optional(),
  DATADOG_SITE: Joi.string().default('datadoghq.com'),

  // WebSocket CORS
  SOCKET_CORS_ORIGIN: Joi.string().default('http://localhost:3000,http://localhost:4200'),
});
