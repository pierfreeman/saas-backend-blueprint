/**
 * worker-bootstrap.ts — Bootstraps the worker-a application context for integration testing.
 *
 * Uses NestFactory.createApplicationContext() instead of NestFactory.create() because
 * the worker is a message-consumer with no HTTP server. This gives us access to
 * all DI providers (WorkerController, PrismaBusinessService, PubSubService, etc.)
 * without binding to a port.
 *
 * Lifecycle:
 *   const ctx = await bootstrapWorkerContext();
 *   const controller = ctx.get(WorkerController);
 *   await controller.handleHeavyJobCreated(event);
 *   await ctx.close();
 *
 * Environment: load-env.ts (loaded via Vitest setupFiles) provides .env.test values.
 */
import { INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
// E2e bootstrapping: importing the app module for NestFactory.createApplicationContext() is intentional.
// eslint-disable-next-line @nx/enforce-module-boundaries
import { AppModule as WorkerAppModule } from '@apps/worker-a/app.module';

/**
 * Creates the worker application context for integration testing.
 * Does not start an HTTP server or SQS consumer — tests invoke handlers directly.
 */
export async function bootstrapWorkerContext(): Promise<INestApplicationContext> {
  const ctx = await NestFactory.createApplicationContext(WorkerAppModule, {
    logger: ['error', 'warn'],
  });

  await ctx.init();

  return ctx;
}
