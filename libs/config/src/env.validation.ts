import * as Joi from 'joi';

export const envValidationSchema = Joi.object({
  // Application
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test')
    .default('development'),
  PORT: Joi.number().default(3000),

  // Database
  DATABASE_URL: Joi.string().required(),
  LEGAL_AUDIT_DATABASE_URL: Joi.string().required(),

  // Redis
  REDIS_HOST: Joi.string().required(),
  REDIS_PORT: Joi.number().default(6379),
  REDIS_PASSWORD: Joi.string().allow('').optional(),

  // Auth0
  AUTH0_DOMAIN: Joi.string().required(),
  AUTH0_AUDIENCE: Joi.string().required(),

  // Event Bus
  EVENT_BUS_TRANSPORT: Joi.string().valid('local', 'sqs').default('local'),
  SQS_STANDARD_QUEUE_URL: Joi.string().when('EVENT_BUS_TRANSPORT', {
    is: 'sqs',
    then: Joi.required(),
    otherwise: Joi.optional().allow(''),
  }),
  SQS_FIFO_QUEUE_URL: Joi.string().when('EVENT_BUS_TRANSPORT', {
    is: 'sqs',
    then: Joi.required(),
    otherwise: Joi.optional().allow(''),
  }),
  SQS_ENDPOINT_URL: Joi.string().optional(),
  AWS_REGION: Joi.string().default('eu-west-1'),

  // ── Security ─────────────────────────────────────────────────────────────
  // CORS
  CORS_ALLOWED_ORIGINS: Joi.string().allow('').optional(),
  CORS_CREDENTIALS: Joi.string().valid('true', 'false').default('true'),

  // Rate Limiting
  RATE_LIMIT_TTL: Joi.number().integer().min(1).default(60),
  RATE_LIMIT_MAX_PER_IP: Joi.number().integer().min(1).default(100),
  RATE_LIMIT_MAX_PER_USER: Joi.number().integer().min(1).default(200),
  RATE_LIMIT_MAX_PER_TENANT: Joi.number().integer().min(1).default(1000),

  // Brute-Force Protection
  BRUTE_FORCE_MAX_ATTEMPTS: Joi.number().integer().min(1).default(5),
  BRUTE_FORCE_LOCKOUT_TTL: Joi.number().integer().min(1).default(900),
  BRUTE_FORCE_TRACKING_TTL: Joi.number().integer().min(1).default(3600),

  // CSRF (disabled by default; only needed for cookie-based auth flows)
  CSRF_PROTECTION_ENABLED: Joi.string().valid('true', 'false').default('false'),
  CSRF_COOKIE_NAME: Joi.string().default('__csrf'),
  CSRF_HEADER_NAME: Joi.string().default('x-csrf-token'),

  // IP Filter (optional enterprise feature)
  IP_ALLOWLIST_ENABLED: Joi.string().valid('true', 'false').default('false'),
  IP_ALLOWLIST: Joi.string().allow('').optional(),
  IP_DENYLIST_ENABLED: Joi.string().valid('true', 'false').default('false'),
  IP_DENYLIST: Joi.string().allow('').optional(),

  // Request Body Size Limit
  MAX_BODY_SIZE: Joi.string().default('2mb'),

  // Payload Sanitization (SQL/NoSQL/XSS pattern detection)
  PAYLOAD_SANITIZATION_ENABLED: Joi.string()
    .valid('true', 'false')
    .default('true'),

  // WebSocket Rate Limiting
  WS_RATE_LIMIT_ENABLED: Joi.string().valid('true', 'false').default('true'),
  WS_RATE_LIMIT_MAX_MESSAGES_PER_MINUTE: Joi.number()
    .integer()
    .min(1)
    .default(60),

  // Stripe (optional — billing module checks at runtime)
  STRIPE_SECRET_KEY: Joi.string().optional(),
  STRIPE_WEBHOOK_SECRET: Joi.string().optional(),
  STRIPE_PRICE_ID_BASIC: Joi.string().optional(),
  STRIPE_PRICE_ID_PRO: Joi.string().optional(),
  STRIPE_MAX_RETRIES: Joi.number().integer().min(0).max(10).default(3),
  STRIPE_RETRY_BASE_DELAY_MS: Joi.number().integer().min(0).default(500),

  // ── Observability ─────────────────────────────────────────────────────────
  // Sentry error monitoring
  SENTRY_DSN: Joi.string().uri().allow('').optional(),
  SENTRY_ENABLED: Joi.string().valid('true', 'false').default('true'),
  SENTRY_TRACES_SAMPLE_RATE: Joi.number().min(0).max(1).default(0.1),

  // Structured logging
  LOG_LEVEL: Joi.string()
    .valid('verbose', 'debug', 'log', 'warn', 'error', 'fatal')
    .default('log'),
  LOG_FORMAT: Joi.string().valid('json', 'pretty').optional(),

  // Release / version tracking
  APP_VERSION: Joi.string().allow('').optional(),

  // Prometheus metrics (placeholder)
  PROMETHEUS_ENABLED: Joi.string().valid('true', 'false').default('false'),

  // Datadog APM (placeholder)
  DATADOG_ENABLED: Joi.string().valid('true', 'false').default('false'),
  DATADOG_SERVICE_NAME: Joi.string().optional(),

  // ── Email ─────────────────────────────────────────────────────────────────
  EMAIL_PROVIDER: Joi.string().valid('sendgrid').default('sendgrid'),
  SENDGRID_API_KEY: Joi.string().when('EMAIL_PROVIDER', {
    is: 'sendgrid',
    then: Joi.string().optional().allow(''),
    otherwise: Joi.optional(),
  }),
  EMAIL_FROM_ADDRESS: Joi.string().email().optional(),
  EMAIL_FROM_NAME: Joi.string().optional().allow(''),
});
