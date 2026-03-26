import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { PayloadSanitizationMiddleware } from './payload-sanitization.middleware';
import { Mock, vi } from 'vitest';
import { LegalAuditService } from '@libs/legal-audit';

// Mock @libs/legal-audit to avoid compiling Prisma-generated client in unit tests
vi.mock('@libs/legal-audit', () => ({
  LegalAuditService: class MockLegalAuditService {
    recordEvent = vi.fn();
  },
  LegalAuditModule: { module: class {} },
}));

// ─── helpers ─────────────────────────────────────────────────────────────────

function makeReq(overrides: Partial<Request> = {}): Request {
  return {
    headers: { 'x-forwarded-for': '1.2.3.4' },
    socket: { remoteAddress: '1.2.3.4' },
    url: '/api/test',
    method: 'POST',
    body: undefined,
    query: {},
    params: {},
    ...overrides,
  } as unknown as Request;
}

const mockRes = {} as Response;

describe('PayloadSanitizationMiddleware', () => {
  let middleware: PayloadSanitizationMiddleware;
  let legalAudit: { recordEvent: Mock };

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        PayloadSanitizationMiddleware,
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) => {
              if (key === 'security.payloadSanitization.enabled') return true;
              return undefined;
            },
          },
        },
        {
          provide: LegalAuditService,
          useValue: new LegalAuditService(),
        },
      ],
    }).compile();

    middleware = module.get(PayloadSanitizationMiddleware);
    legalAudit = module.get(LegalAuditService) as unknown as {
      recordEvent: Mock;
    };
  });

  // ── Clean requests ──────────────────────────────────────────────────────────

  it('passes clean body through without modification', () => {
    const req = makeReq({ body: { email: 'user@example.com', name: 'Alice' } });
    const next = vi.fn();
    middleware.use(req, mockRes, next);
    expect(next).toHaveBeenCalled();
    expect(req.body).toEqual({ email: 'user@example.com', name: 'Alice' });
    expect(legalAudit.recordEvent).not.toHaveBeenCalled();
  });

  it('passes request with no body', () => {
    const req = makeReq({ body: undefined });
    const next = vi.fn();
    middleware.use(req, mockRes, next);
    expect(next).toHaveBeenCalled();
  });

  // ── Disabled middleware ─────────────────────────────────────────────────────

  it('skips all checks when payload sanitization is disabled', async () => {
    const disabledModule = await Test.createTestingModule({
      providers: [
        PayloadSanitizationMiddleware,
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) => {
              if (key === 'security.payloadSanitization.enabled') return false;
              return undefined;
            },
          },
        },
        { provide: LegalAuditService, useValue: new LegalAuditService() },
      ],
    }).compile();
    const disabled = disabledModule.get(PayloadSanitizationMiddleware);

    const req = makeReq({ body: { q: "' UNION SELECT * FROM users--" } });
    const next = vi.fn();
    disabled.use(req, mockRes, next);
    expect(next).toHaveBeenCalled();
  });

  // ── NoSQL injection ─────────────────────────────────────────────────────────

  it('blocks body with MongoDB $where operator key', () => {
    const req = makeReq({ body: { $where: 'this.isAdmin === true' } });
    const next = vi.fn();
    expect(() => middleware.use(req, mockRes, next)).toThrow(
      BadRequestException,
    );
    expect(legalAudit.recordEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'security.payload.nosql_injection_attempt',
      }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('blocks nested $ operator key in body', () => {
    const req = makeReq({
      body: { filter: { age: { $gt: 0 } } },
    });
    const next = vi.fn();
    expect(() => middleware.use(req, mockRes, next)).toThrow(
      BadRequestException,
    );
  });

  it('blocks $ operator inside an array element', () => {
    const req = makeReq({ body: { items: [{ $ne: null }] } });
    const next = vi.fn();
    expect(() => middleware.use(req, mockRes, next)).toThrow(
      BadRequestException,
    );
  });

  // ── SQL injection ───────────────────────────────────────────────────────────

  it('blocks UNION SELECT in body string value', () => {
    const req = makeReq({
      body: { search: '1 UNION SELECT username,password FROM users' },
    });
    const next = vi.fn();
    expect(() => middleware.use(req, mockRes, next)).toThrow(
      BadRequestException,
    );
    expect(legalAudit.recordEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'security.payload.sql_injection_attempt',
      }),
    );
  });

  it('blocks DROP TABLE in query param', () => {
    const req = makeReq({
      body: undefined,
      query: { q: 'DROP TABLE users' },
    });
    const next = vi.fn();
    expect(() => middleware.use(req, mockRes, next)).toThrow(
      BadRequestException,
    );
  });

  it("blocks boolean-based injection (' OR 1=1)", () => {
    const req = makeReq({ body: { username: "admin' OR 1=1" } });
    const next = vi.fn();
    expect(() => middleware.use(req, mockRes, next)).toThrow(
      BadRequestException,
    );
  });

  it('does not block innocent SQL-adjacent words in normal content', () => {
    // "SELECT" alone in text should NOT trigger — only structural injection syntax
    const req = makeReq({
      body: {
        description: 'Please select the item from the dropdown menu.',
        comment: 'order by preference',
      },
    });
    const next = vi.fn();
    middleware.use(req, mockRes, next);
    expect(next).toHaveBeenCalled();
  });

  // ── XSS sanitization ───────────────────────────────────────────────────────

  it('sanitizes <script> tag from body and calls next', () => {
    const req = makeReq({
      body: { comment: 'Hello <script>alert(1)</script> World' },
    });
    const next = vi.fn();
    middleware.use(req, mockRes, next);
    expect(next).toHaveBeenCalled();
    expect((req.body as Record<string, string>)['comment']).not.toContain(
      '<script>',
    );
    expect(legalAudit.recordEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'security.payload.xss_sanitized' }),
    );
  });

  it('sanitizes javascript: URI from body', () => {
    const req = makeReq({
      body: { url: 'javascript:alert(document.cookie)' },
    });
    const next = vi.fn();
    middleware.use(req, mockRes, next);
    expect(next).toHaveBeenCalled();
    expect((req.body as Record<string, string>)['url']).not.toContain(
      'javascript:',
    );
  });

  it('sanitizes inline event handler from body', () => {
    const req = makeReq({
      body: { bio: '<img src=x onerror=alert(1)>' },
    });
    const next = vi.fn();
    middleware.use(req, mockRes, next);
    expect(next).toHaveBeenCalled();
    expect((req.body as Record<string, string>)['bio']).not.toContain(
      'onerror=',
    );
  });

  it('sanitizes XSS in nested object without blocking', () => {
    const req = makeReq({
      body: { profile: { bio: 'Hi <script>xss</script>' } },
    });
    const next = vi.fn();
    middleware.use(req, mockRes, next);
    expect(next).toHaveBeenCalled();
    const body = req.body as { profile: { bio: string } };
    expect(body.profile.bio).not.toContain('<script>');
  });
});
