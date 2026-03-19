/**
 * IpFilterGuard — unit tests
 *
 * Evaluation order:
 *  1. Denylist check  — if enabled AND IP is in the denylist → 403
 *  2. Allowlist check — if enabled AND IP is NOT in the allowlist → 403
 *  3. Pass through    — if neither condition triggers
 *
 * All block events are written to the legal audit log.
 */
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { IpFilterGuard } from './ip-filter.guard';

// Mock @libs/legal-audit to avoid compiling Prisma-generated client in unit tests
jest.mock('@libs/legal-audit', () => ({
  LegalAuditService: class MockLegalAuditService {
    recordEvent = jest.fn();
  },
  LegalAuditModule: { module: class {} },
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { LegalAuditService } = require('@libs/legal-audit') as {
  LegalAuditService: new () => { recordEvent: jest.Mock };
};

// ── Helpers ───────────────────────────────────────────────────────────────────

interface FilterConfig {
  allowlistEnabled?: boolean;
  allowedIps?: string[];
  denylistEnabled?: boolean;
  deniedIps?: string[];
}

function makeContext(ip: string): ExecutionContext {
  return {
    getType: () => 'http',
    switchToHttp: () => ({
      getRequest: () => ({
        headers: { 'x-forwarded-for': ip },
        socket: { remoteAddress: ip },
        url: '/api/admin',
      }),
    }),
  } as unknown as ExecutionContext;
}

async function buildGuard(config: FilterConfig = {}): Promise<{
  guard: IpFilterGuard;
  legalAudit: { recordEvent: jest.Mock };
}> {
  const legalAudit = new LegalAuditService();

  const configValues: Record<string, unknown> = {
    'security.ipFilter.allowlistEnabled': config.allowlistEnabled ?? false,
    'security.ipFilter.allowedIps': config.allowedIps ?? [],
    'security.ipFilter.denylistEnabled': config.denylistEnabled ?? false,
    'security.ipFilter.deniedIps': config.deniedIps ?? [],
  };

  const module = await Test.createTestingModule({
    providers: [
      IpFilterGuard,
      {
        provide: ConfigService,
        useValue: { get: (k: string) => configValues[k] },
      },
      { provide: LegalAuditService, useValue: legalAudit },
    ],
  }).compile();

  return { guard: module.get(IpFilterGuard), legalAudit };
}

// ── Suite ─────────────────────────────────────────────────────────────────────

describe('IpFilterGuard', () => {
  afterEach(() => jest.clearAllMocks());

  // ── Both lists disabled (default) ─────────────────────────────────────────

  describe('when both allowlist and denylist are disabled (default)', () => {
    it('allows any IP', async () => {
      const { guard } = await buildGuard();
      expect(guard.canActivate(makeContext('1.2.3.4'))).toBe(true);
      expect(guard.canActivate(makeContext('9.9.9.9'))).toBe(true);
    });
  });

  // ── Denylist ──────────────────────────────────────────────────────────────

  describe('denylist', () => {
    it('blocks an IP that is on the denylist', async () => {
      const { guard } = await buildGuard({
        denylistEnabled: true,
        deniedIps: ['5.5.5.5'],
      });
      expect(() => guard.canActivate(makeContext('5.5.5.5'))).toThrow(
        ForbiddenException,
      );
    });

    it('allows an IP that is NOT on the denylist', async () => {
      const { guard } = await buildGuard({
        denylistEnabled: true,
        deniedIps: ['5.5.5.5'],
      });
      expect(guard.canActivate(makeContext('1.2.3.4'))).toBe(true);
    });

    it('records a legal audit event when an IP is blocked by the denylist', async () => {
      const { guard, legalAudit } = await buildGuard({
        denylistEnabled: true,
        deniedIps: ['7.7.7.7'],
      });
      try {
        guard.canActivate(makeContext('7.7.7.7'));
      } catch {
        // expected
      }
      expect(legalAudit.recordEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'security.ip_filter.denied',
          metadata: expect.objectContaining({
            ip: '7.7.7.7',
            rule: 'denylist',
          }),
        }),
      );
    });

    it('denylist takes priority over allowlist', async () => {
      // IP is on both lists — deny wins
      const { guard } = await buildGuard({
        denylistEnabled: true,
        deniedIps: ['3.3.3.3'],
        allowlistEnabled: true,
        allowedIps: ['3.3.3.3'],
      });
      expect(() => guard.canActivate(makeContext('3.3.3.3'))).toThrow(
        ForbiddenException,
      );
    });
  });

  // ── Allowlist ─────────────────────────────────────────────────────────────

  describe('allowlist', () => {
    it('blocks an IP that is NOT in the allowlist', async () => {
      const { guard } = await buildGuard({
        allowlistEnabled: true,
        allowedIps: ['10.0.0.1'],
      });
      expect(() => guard.canActivate(makeContext('1.2.3.4'))).toThrow(
        ForbiddenException,
      );
    });

    it('allows an IP that IS in the allowlist', async () => {
      const { guard } = await buildGuard({
        allowlistEnabled: true,
        allowedIps: ['10.0.0.1', '1.2.3.4'],
      });
      expect(guard.canActivate(makeContext('1.2.3.4'))).toBe(true);
    });

    it('records a legal audit event when an IP is blocked by the allowlist', async () => {
      const { guard, legalAudit } = await buildGuard({
        allowlistEnabled: true,
        allowedIps: ['10.0.0.1'],
      });
      try {
        guard.canActivate(makeContext('2.2.2.2'));
      } catch {
        // expected
      }
      expect(legalAudit.recordEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'security.ip_filter.not_allowed',
          metadata: expect.objectContaining({
            ip: '2.2.2.2',
            rule: 'allowlist',
          }),
        }),
      );
    });
  });
});
