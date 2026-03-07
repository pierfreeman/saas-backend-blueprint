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

  // Stripe (optional — billing module checks at runtime)
  STRIPE_SECRET_KEY: Joi.string().optional(),
  STRIPE_WEBHOOK_SECRET: Joi.string().optional(),
  STRIPE_PRICE_ID_BASIC: Joi.string().optional(),
  STRIPE_PRICE_ID_PRO: Joi.string().optional(),
  STRIPE_MAX_RETRIES: Joi.number().integer().min(0).max(10).default(3),
  STRIPE_RETRY_BASE_DELAY_MS: Joi.number().integer().min(0).default(500),
});
