import { BruteForceGuard } from './brute-force.guard';
import { BruteForceService } from '../services/brute-force.service';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { ExecutionContext, HttpException, HttpStatus } from '@nestjs/common';
import type { Request } from 'express';

// Mock @libs/legal-audit to avoid compiling Prisma-generated client in unit tests
jest.mock('@libs/legal-audit', () => ({
  LegalAuditService: class MockLegalAuditService {
    recordEvent = jest.fn();
  },
  LegalAuditModule: { module: class {} },
}));

// Import after mock is defined
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { LegalAuditService } = require('@libs/legal-audit') as {
  LegalAuditService: new () => { recordEvent: jest.Mock };
};

// ─── helpers ─────────────────────────────────────────────────────────────────

function makeHttpContext(ip = '1.2.3.4'): ExecutionContext {
  const req = {
    headers: { 'x-forwarded-for': ip },
    socket: { remoteAddress: ip },
    url: '/api/test',
    method: 'POST',
  } as unknown as Request;

  return {
    getType: () => 'http',
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

describe('BruteForceGuard', () => {
  let guard: BruteForceGuard;
  let bruteForceService: jest.Mocked<BruteForceService>;
  let legalAuditService: { recordEvent: jest.Mock };

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        BruteForceGuard,
        {
          provide: BruteForceService,
          useValue: {
            getState: jest.fn(),
            isLocked: jest.fn(),
            recordFailedAttempt: jest.fn(),
            resetAttempts: jest.fn(),
          },
        },
        {
          provide: LegalAuditService,
          useValue: {
            recordEvent: jest.fn(),
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn(),
          },
        },
      ],
    }).compile();

    guard = module.get(BruteForceGuard);
    bruteForceService =
      module.get<jest.Mocked<BruteForceService>>(BruteForceService);
    legalAuditService = module.get<{ recordEvent: jest.Mock }>(
      LegalAuditService,
    );
  });

  describe('Unlocked IP', () => {
    it('allows the request when not locked', async () => {
      bruteForceService.getState.mockResolvedValue({
        locked: false,
        attempts: 2,
        lockoutRemainingSeconds: 0,
      });

      const result = await guard.canActivate(makeHttpContext());
      expect(result).toBe(true);
    });
  });

  describe('Locked IP', () => {
    beforeEach(() => {
      bruteForceService.getState.mockResolvedValue({
        locked: true,
        attempts: 5,
        lockoutRemainingSeconds: 850,
      });
    });

    it('throws 429 Too Many Requests when IP is locked', async () => {
      await expect(guard.canActivate(makeHttpContext())).rejects.toThrow(
        HttpException,
      );

      try {
        await guard.canActivate(makeHttpContext());
      } catch (err) {
        expect(err instanceof HttpException).toBe(true);
        expect((err as HttpException).getStatus()).toBe(
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    });

    it('includes retryAfter in the exception body', async () => {
      try {
        await guard.canActivate(makeHttpContext());
      } catch (err) {
        const response = (err as HttpException).getResponse() as {
          retryAfter: number;
        };
        expect(response.retryAfter).toBe(850);
      }
    });

    it('records a compliance event for blocked requests', async () => {
      try {
        await guard.canActivate(makeHttpContext('5.6.7.8'));
      } catch {
        // expected
      }

      expect(legalAuditService.recordEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'security.brute_force.blocked',
        }),
      );
    });
  });
});
