import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { AttackDetectionService } from '../../../src/modules/security/services/attack-detection.service';
import { RedisService } from '../../../src/redis/redis.service';

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

describe('AttackDetectionService', () => {
  let service: AttackDetectionService;
  const redisMock = new InMemoryRedisMock();

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AttackDetectionService,
        {
          provide: ConfigService,
          useValue: {
            get: (key: string): string => {
              const values: Record<string, string> = {
                RATE_LIMIT_REQUESTS: '2',
                RATE_LIMIT_WINDOW_MS: '60000',
                RATE_LIMIT_BURST: '0',
                BRUTE_FORCE_MAX_ATTEMPTS: '3',
                BRUTE_FORCE_BLOCK_MS: '10000',
                SUSPICIOUS_SCORE_THRESHOLD: '5',
              };
              return values[key];
            },
          },
        },
        {
          provide: RedisService,
          useValue: redisMock,
        },
      ],
    }).compile();

    service = module.get<AttackDetectionService>(AttackDetectionService);
  });

  const createRequest = (): Request =>
    ({
      method: 'POST',
      path: '/auth/login',
      url: '/auth/login',
      ip: '127.0.0.1',
      headers: {},
      socket: { remoteAddress: '127.0.0.1' },
    }) as unknown as Request;

  it('should block requests when rate limit is exceeded', async () => {
    const request = createRequest();

    await service.checkRateLimit(request);
    await service.checkRateLimit(request);
    const third = await service.checkRateLimit(request);

    expect(third.blocked).toBe(true);
    expect(third.limit).toBe(2);
  });

  it('should mark identity as blocked after brute-force threshold', async () => {
    const request = createRequest();

    await service.registerAuthFailure(request, 'user@example.com');
    await service.registerAuthFailure(request, 'user@example.com');
    await service.registerAuthFailure(request, 'user@example.com');

    const status = await service.getBruteForceStatus(request, 'user@example.com');
    expect(status.blocked).toBe(true);
    expect(status.retryAfterSeconds).toBeGreaterThan(0);
  });
});
