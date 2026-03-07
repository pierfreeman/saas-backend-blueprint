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

  // Stripe (optional — billing module checks at runtime)
  STRIPE_SECRET_KEY: Joi.string().optional(),
  STRIPE_WEBHOOK_SECRET: Joi.string().optional(),
  STRIPE_PRICE_ID_BASIC: Joi.string().optional(),
  STRIPE_PRICE_ID_PRO: Joi.string().optional(),
});
