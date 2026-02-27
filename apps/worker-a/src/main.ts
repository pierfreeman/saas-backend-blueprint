import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const logger = new Logger('Worker-Compute-A');

  // Run as a standalone application context (no HTTP server, no Redis Transport).
  // SQS long-polling is handled by SqsConsumerService which starts on module init.
  // In all deployment environments (Docker, AWS ECS) env vars are injected by
  // the platform; locally they are read from .env via ConfigModule.
  const app = await NestFactory.createApplicationContext(AppModule);

  // Ensure onModuleDestroy hooks fire on SIGTERM/SIGINT (Docker stop, K8s pod eviction).
  app.enableShutdownHooks();

  logger.log('Worker-Compute-A started — polling SQS for events');
}

bootstrap().catch((error) => {
  console.error('Worker-Compute-A failed to start:', error);
  process.exit(1);
});
