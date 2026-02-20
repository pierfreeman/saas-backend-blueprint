import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { RedisService } from '../../src/redis/redis.service';
import { AllExceptionsFilter } from '../../src/common/filters/all-exceptions.filter';
import { LoggingInterceptor } from '../../src/config/logging.interceptor';

/**
 * Factory for creating a NestJS test application
 * Used for E2E tests with full app bootstrap
 */
export class TestAppFactory {
  /**
   * Creates and configures a test application (static method for E2E tests)
   */
  static async createApp(overrides?: {
    providers?: Array<{ provide: unknown; useValue: unknown }>;
    guards?: Array<{ provide: unknown; useValue: unknown }>;
  }): Promise<INestApplication> {
    const moduleBuilder = Test.createTestingModule({
      imports: [AppModule],
    });

    // Apply overrides if provided
    if (overrides?.providers) {
      overrides.providers.forEach((override) => {
        moduleBuilder.overrideProvider(override.provide).useValue(override.useValue);
      });
    }

    if (overrides?.guards) {
      overrides.guards.forEach((override) => {
        moduleBuilder.overrideGuard(override.provide).useValue(override.useValue);
      });
    }

    const moduleRef = await moduleBuilder.compile();
    const app = moduleRef.createNestApplication();

    // Configure app same as in main.ts
    app.enableCors({
      origin: '*',
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
    });

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

    app.useGlobalFilters(new AllExceptionsFilter());
    app.useGlobalInterceptors(new LoggingInterceptor());

    await app.listen(0); // port 0 = OS assigns a free port; also calls init()
    return app;
  }

  /**
   * Cleans up the test application and closes all connections (static method)
   */
  static async cleanup(app: INestApplication): Promise<void> {
    if (app) {
      try {
        const prismaService = app.get(PrismaService);

        // Clean up database
        await TestAppFactory.cleanDatabase(prismaService);

        await app.close();
      } catch (error) {
        console.error('Error during cleanup:', error);
      }
    }
  }

  /**
   * Cleans all data from the database (static method)
   */
  private static async cleanDatabase(prismaService: PrismaService): Promise<void> {
    try {
      // Delete in order to respect foreign key constraints
      await prismaService.auditEvent.deleteMany();
      await prismaService.subscription.deleteMany();
      await prismaService.player.deleteMany();
      await prismaService.team.deleteMany();
      await prismaService.membership.deleteMany();
      await prismaService.organization.deleteMany();
      await prismaService.user.deleteMany();
    } catch (error) {
      console.error('Error cleaning database:', error);
    }
  }
}
