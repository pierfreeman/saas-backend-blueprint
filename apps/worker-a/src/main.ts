import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { Logger } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const logger = new Logger('Worker-Compute-A');

  // Note: transport options are evaluated before the DI container initialises
  // ConfigModule, so process.env is the only option here. In all deployment
  // environments (Docker, AWS) these vars are injected by the platform.
  const app = await NestFactory.createMicroservice<MicroserviceOptions>(
    AppModule,
    {
      transport: Transport.REDIS,
      options: {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379'),
      },
    },
  );

  // Ensure onModuleDestroy is called on SIGTERM/SIGINT (e.g. Docker stop, K8s)
  app.enableShutdownHooks();

  await app.listen();
  logger.log('Worker-Compute-A started and listening to Redis events');
}

bootstrap().catch((error) => {
  console.error('Worker-Compute-A failed to start:', error);
  process.exit(1);
});
