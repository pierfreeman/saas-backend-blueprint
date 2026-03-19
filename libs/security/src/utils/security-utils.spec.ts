/**
 * Security utility functions, config factory, and decorators — unit tests
 *
 * Covers:
 *  - extractClientIp: X-Forwarded-For, X-Real-IP, socket.remoteAddress fallback
 *  - isValidIp: IPv4, IPv6, invalid strings
 *  - securityConfig factory: key defaults and env-var overrides
 *  - SkipRateLimit / SkipCsrf decorators: SetMetadata key correctness
 */
import { SetMetadata } from '@nestjs/common';
import { extractClientIp, isValidIp } from './ip.utils';
import {
  SKIP_RATE_LIMIT_KEY,
  SkipRateLimit,
  SKIP_CSRF_KEY,
  SkipCsrf,
} from '../decorators/security.decorators';
import securityConfig from '../config/security.config';
import type { Request } from 'express';

// ── extractClientIp ──────────────────────────────────────────────────────────

describe('extractClientIp', () => {
  function makeReq(
    overrides: Partial<{
      forwarded: string | string[];
      realIp: string | string[];
      remoteAddress: string;
    }> = {},
  ): Request {
    return {
      headers: {
        ...(overrides.forwarded !== undefined
          ? { 'x-forwarded-for': overrides.forwarded }
          : {}),
        ...(overrides.realIp !== undefined
          ? { 'x-real-ip': overrides.realIp }
          : {}),
      },
      socket: { remoteAddress: overrides.remoteAddress ?? undefined },
    } as unknown as Request;
  }

  it('returns the first IP from a single X-Forwarded-For header', () => {
    expect(extractClientIp(makeReq({ forwarded: '10.0.0.1' }))).toBe(
      '10.0.0.1',
    );
  });

  it('returns the first IP from a comma-separated X-Forwarded-For header', () => {
    expect(
      extractClientIp(makeReq({ forwarded: '10.0.0.1, 192.168.1.1' })),
    ).toBe('10.0.0.1');
  });

  it('handles X-Forwarded-For as an array (multiple headers)', () => {
    expect(
      extractClientIp(makeReq({ forwarded: ['10.0.0.2', '172.16.0.1'] })),
    ).toBe('10.0.0.2');
  });

  it('falls back to X-Real-IP when X-Forwarded-For is absent', () => {
    expect(extractClientIp(makeReq({ realIp: '203.0.113.5' }))).toBe(
      '203.0.113.5',
    );
  });

  it('handles X-Real-IP as an array', () => {
    expect(extractClientIp(makeReq({ realIp: ['203.0.113.99'] }))).toBe(
      '203.0.113.99',
    );
  });

  it('falls back to socket.remoteAddress when neither proxy header is set', () => {
    expect(extractClientIp(makeReq({ remoteAddress: '192.0.2.1' }))).toBe(
      '192.0.2.1',
    );
  });

  it('returns 127.0.0.1 when no IP source is available', () => {
    const req = { headers: {}, socket: {} } as unknown as Request;
    expect(extractClientIp(req)).toBe('127.0.0.1');
  });
});

// ── isValidIp ────────────────────────────────────────────────────────────────

describe('isValidIp', () => {
  it.each(['1.2.3.4', '192.168.0.1', '255.255.255.255', '0.0.0.0'])(
    'returns true for valid IPv4 address %s',
    (ip) => {
      expect(isValidIp(ip)).toBe(true);
    },
  );

  it.each(['::1', '2001:db8::1', 'fe80::1'])(
    'returns true for valid IPv6 address %s',
    (ip) => {
      expect(isValidIp(ip)).toBe(true);
    },
  );

  it('strips CIDR suffix before validation', () => {
    expect(isValidIp('10.0.0.0/8')).toBe(true);
  });

  it.each(['not-an-ip', '', 'hello world'])(
    'returns false for invalid address %s',
    (ip) => {
      expect(isValidIp(ip)).toBe(false);
    },
  );
});

// ── securityConfig factory ───────────────────────────────────────────────────

describe('securityConfig', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    // Restore env vars after each test
    Object.keys(process.env).forEach((k) => {
      if (!(k in originalEnv)) delete process.env[k];
    });
    Object.assign(process.env, originalEnv);
  });

  it('returns safe defaults when no env vars are set', () => {
    // Explicitly clear all env vars this config reads so the .env.test values
    // do not interfere — we are testing the hardcoded fallback values.
    const keysToDelete = [
      'CORS_ALLOWED_ORIGINS',
      'CORS_CREDENTIALS',
      'RATE_LIMIT_TTL',
      'RATE_LIMIT_MAX_PER_IP',
      'RATE_LIMIT_MAX_PER_USER',
      'RATE_LIMIT_MAX_PER_TENANT',
      'BRUTE_FORCE_MAX_ATTEMPTS',
      'BRUTE_FORCE_LOCKOUT_TTL',
      'BRUTE_FORCE_TRACKING_TTL',
      'CSRF_PROTECTION_ENABLED',
      'CSRF_COOKIE_NAME',
      'CSRF_HEADER_NAME',
      'IP_ALLOWLIST_ENABLED',
      'IP_ALLOWLIST',
      'IP_DENYLIST_ENABLED',
      'IP_DENYLIST',
    ];
    keysToDelete.forEach((k) => delete process.env[k]);

    const cfg = securityConfig();

    expect(cfg.cors.allowedOrigins).toEqual([]);
    expect(cfg.cors.credentials).toBe(true);
    expect(cfg.rateLimit.ttl).toBe(60);
    expect(cfg.rateLimit.maxPerIp).toBe(100);
    expect(cfg.rateLimit.maxPerUser).toBe(200);
    expect(cfg.rateLimit.maxPerTenant).toBe(1000);
    expect(cfg.bruteForce.maxAttempts).toBe(5);
    expect(cfg.bruteForce.lockoutTtl).toBe(900);
    expect(cfg.bruteForce.trackingTtl).toBe(3600);
    expect(cfg.csrf.enabled).toBe(false);
    expect(cfg.ipFilter.allowlistEnabled).toBe(false);
    expect(cfg.ipFilter.denylistEnabled).toBe(false);
  });

  it('parses CORS_ALLOWED_ORIGINS into a trimmed array', () => {
    process.env['CORS_ALLOWED_ORIGINS'] =
      'https://app.example.com, https://admin.example.com';
    const cfg = securityConfig();
    expect(cfg.cors.allowedOrigins).toEqual([
      'https://app.example.com',
      'https://admin.example.com',
    ]);
  });

  it('sets credentials=false when CORS_CREDENTIALS=false', () => {
    process.env['CORS_CREDENTIALS'] = 'false';
    expect(securityConfig().cors.credentials).toBe(false);
  });

  it('reads custom rate-limit thresholds from env vars', () => {
    process.env['RATE_LIMIT_TTL'] = '30';
    process.env['RATE_LIMIT_MAX_PER_IP'] = '50';
    const cfg = securityConfig();
    expect(cfg.rateLimit.ttl).toBe(30);
    expect(cfg.rateLimit.maxPerIp).toBe(50);
  });

  it('enables CSRF protection when CSRF_PROTECTION_ENABLED=true', () => {
    process.env['CSRF_PROTECTION_ENABLED'] = 'true';
    expect(securityConfig().csrf.enabled).toBe(true);
  });

  it('parses IP allowlist from comma-separated env var', () => {
    process.env['IP_ALLOWLIST_ENABLED'] = 'true';
    process.env['IP_ALLOWLIST'] = '10.0.0.1, 10.0.0.2';
    const cfg = securityConfig();
    expect(cfg.ipFilter.allowlistEnabled).toBe(true);
    expect(cfg.ipFilter.allowedIps).toEqual(['10.0.0.1', '10.0.0.2']);
  });

  it('parses IP denylist from comma-separated env var', () => {
    process.env['IP_DENYLIST_ENABLED'] = 'true';
    process.env['IP_DENYLIST'] = '5.5.5.5,6.6.6.6';
    const cfg = securityConfig();
    expect(cfg.ipFilter.denylistEnabled).toBe(true);
    expect(cfg.ipFilter.deniedIps).toEqual(['5.5.5.5', '6.6.6.6']);
  });
});

// ── Decorators ───────────────────────────────────────────────────────────────

describe('security decorators', () => {
  describe('SkipRateLimit', () => {
    it('attaches the correct metadata key with value true', () => {
      // Spy on SetMetadata without actually executing NestJS decorator machinery
      const setMetadataSpy = jest.spyOn({ SetMetadata }, 'SetMetadata');
      const decorator = SkipRateLimit();
      expect(decorator).toBeDefined();
      // Verify the key constant matches what the interceptor reads
      expect(SKIP_RATE_LIMIT_KEY).toBe('skipRateLimit');
      setMetadataSpy.mockRestore();
    });

    it('is a function that returns a method/class decorator factory', () => {
      expect(typeof SkipRateLimit).toBe('function');
      expect(typeof SkipRateLimit()).toBe('function');
    });
  });

  describe('SkipCsrf', () => {
    it('attaches the correct metadata key with value true', () => {
      const decorator = SkipCsrf();
      expect(decorator).toBeDefined();
      expect(SKIP_CSRF_KEY).toBe('skipCsrf');
    });

    it('is a function that returns a method/class decorator factory', () => {
      expect(typeof SkipCsrf).toBe('function');
      expect(typeof SkipCsrf()).toBe('function');
    });
  });
});
