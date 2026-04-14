import { Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import appConfig from './app.config';
import authConfig from './auth.config';
import databaseConfig from './database.config';
import redisConfig from './redis.config';
import storageConfig from './storage.config';
import emailConfig from './email.config';
import aiConfig from './ai.config';
import { observabilityConfig } from '@libs/observability';
import { envValidationSchema } from './env.validation';

/**
 * ConfigModule
 *
 * Loads configuration from environment variables and validates them with Joi.
 *
 * ─── Future: AWS Secrets Manager ─────────────────────────────────────────────
 * When moving to AWS SM, replace the `load` array with async factory functions
 * that pull values from SSM/Secrets Manager via the AWS SDK, e.g.:
 *
 *   load: [
 *     async () => {
 *       const client = new SecretsManagerClient({ region: 'eu-west-1' });
 *       const secret = await client.send(new GetSecretValueCommand({ SecretId: 'saas-backend/prod' }));
 *       return JSON.parse(secret.SecretString!);
 *     },
 *   ]
 *
 * The rest of the application (ConfigService consumers) stays unchanged because
 * all values are still accessed via `configService.get('database.url')` etc.
 * ─────────────────────────────────────────────────────────────────────────────
 */
@Module({
  imports: [
    NestConfigModule.forRoot({
      isGlobal: true,
      load: [
        appConfig,
        authConfig,
        databaseConfig,
        redisConfig,
        storageConfig,
        emailConfig,
        aiConfig,
        observabilityConfig,
      ],
      envFilePath: '.env',
      validationSchema: envValidationSchema,
      validationOptions: {
        abortEarly: true,
      },
    }),
  ],
})
export class ConfigModule {}
