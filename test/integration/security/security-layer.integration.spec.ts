import { Body, Controller, Post, UnauthorizedException } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { SecurityModule } from '../../../src/modules/security/security.module';
import { RedisService } from '../../../src/redis/redis.service';
import { EventBusService } from '../../../src/events/event-bus.service';
import { SecurityExceptionsFilter } from '../../../src/modules/security/filters/security-exceptions.filter';
import { SecurityLoggerService } from '../../../src/modules/security/services/security-logger.service';

class InMemoryRedisMock {
  private values = new Map<string, string>();
  private expirations = new Map<string, number>();

  async get(key: string): Promise<string | null> {
    this.cleanup(key);
    return this.values.get(key) || null;
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<'OK'> {
    this.values.set(key, value);
    if (ttlSeconds) {
      this.expirations.set(key, Date.now() + ttlSeconds * 1000);
    }
    return 'OK';
  }

  async del(key: string): Promise<number> {
    const existed = this.values.delete(key) ? 1 : 0;
    this.expirations.delete(key);
    return existed;
  }

  async incr(key: string): Promise<number> {
    this.cleanup(key);
    const current = Number.parseInt(this.values.get(key) || '0', 10);
    const next = current + 1;
    this.values.set(key, String(next));
    return next;
  }

  async expire(key: string, seconds: number): Promise<number> {
    if (!this.values.has(key)) {
      return 0;
    }

    this.expirations.set(key, Date.now() + seconds * 1000);
    return 1;
  }

  async ttl(key: string): Promise<number> {
    this.cleanup(key);
    const expiration = this.expirations.get(key);
    if (!expiration) {
      return -1;
    }

    const delta = Math.ceil((expiration - Date.now()) / 1000);
    return delta > 0 ? delta : -2;
  }

  private cleanup(key: string): void {
    const expiration = this.expirations.get(key);
    if (expiration && Date.now() > expiration) {
      this.values.delete(key);
      this.expirations.delete(key);
    }
  }
}

@Controller()
class SecurityTestController {
  @Post('auth/login')
  login(@Body() body: { password?: string }): { ok: boolean } {
    if (body.password !== 'secret') {
      throw new UnauthorizedException('Invalid credentials');
    }

    return { ok: true };
  }

  @Post('security-test/echo')
  echo(@Body() body: Record<string, unknown>): Record<string, unknown> {
    return body;
  }

  @Post('security-test/stateful')
  stateful(): { ok: boolean } {
    return { ok: true };
  }
}

describe('Security Layer Integration', () => {
  let app: INestApplication;
  let eventBusMock: { emit: jest.Mock };

  beforeEach(async () => {
    const redisMock = new InMemoryRedisMock();
    eventBusMock = { emit: jest.fn() };

    const moduleBuilder = Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [
            () => ({
              RATE_LIMIT_REQUESTS: '100',
              RATE_LIMIT_WINDOW_MS: '60000',
              RATE_LIMIT_BURST: '0',
              BRUTE_FORCE_MAX_ATTEMPTS: '2',
              BRUTE_FORCE_BLOCK_MS: '60000',
              MAX_BODY_SIZE: '1KB',
              SECURITY_HEADERS_ENABLED: 'true',
              CSRF_PROTECTION_ENABLED: 'true',
              SECURITY_AUTO_THROTTLE_ENABLED: 'true',
            }),
          ],
        }),
        SecurityModule,
      ],
      controllers: [SecurityTestController],
    });

    const moduleRef: TestingModule = await moduleBuilder
      .overrideProvider(RedisService)
      .useValue(redisMock)
      .overrideProvider(EventBusService)
      .useValue(eventBusMock)
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalFilters(new SecurityExceptionsFilter(moduleRef.get(SecurityLoggerService)));
    await app.init();
  });

  afterEach(async () => {
    if (app) {
      await app.close();
    }
  });

  it('should return 413 for oversized payload', async () => {
    const largePayload = { data: 'x'.repeat(2 * 1024) };

    await request(app.getHttpServer()).post('/security-test/echo').send(largePayload).expect(413);
  });

  it('should return 403 for csrf attack simulation', async () => {
    await request(app.getHttpServer())
      .post('/security-test/stateful')
      .set('Cookie', 'sessionId=abc; csrf_token=token-value')
      .send({ value: 1 })
      .expect(403);
  });

  it('should return 400 for suspicious payload and emit audit/security event', async () => {
    await request(app.getHttpServer())
      .post('/security-test/echo')
      .send({ $where: 'this.password.length > 0' })
      .expect(400);

    expect(eventBusMock.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'security.blocked',
      }),
    );
  });

  it('should block repeated auth failures with brute-force middleware', async () => {
    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'test@example.com', password: 'bad' })
      .expect(401);

    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'test@example.com', password: 'bad' })
      .expect(401);

    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'test@example.com', password: 'bad' })
      .expect(429);
  });
});
