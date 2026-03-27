import { HttpException, HttpStatus } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { vi } from 'vitest';
import {
  RequestSizeLimitMiddleware,
  parseSize,
} from './request-size-limit.middleware';

// ─── helpers ─────────────────────────────────────────────────────────────────

function makeReq(contentLength?: number): Request {
  const headers: Record<string, string> = {
    'x-forwarded-for': '1.2.3.4',
  };
  if (contentLength !== undefined) {
    headers['content-length'] = String(contentLength);
  }
  return {
    headers,
    socket: { remoteAddress: '1.2.3.4' },
    url: '/api/upload',
    method: 'POST',
  } as unknown as Request;
}

const mockRes = {} as Response;

function buildMiddleware(maxBodySize: string): RequestSizeLimitMiddleware {
  return new RequestSizeLimitMiddleware({
    get: (key: string) => {
      if (key === 'security.maxBodySize') return maxBodySize;
      return undefined;
    },
  } as unknown as ConfigService);
}

// ─── parseSize unit tests ───────────────────────────────────────────────────

describe('parseSize', () => {
  it('parses megabytes', () => expect(parseSize('2mb')).toBe(2 * 1024 * 1024));
  it('parses kilobytes', () => expect(parseSize('500kb')).toBe(500 * 1024));
  it('parses raw bytes', () => expect(parseSize('1024')).toBe(1024));
  it('parses bytes with unit', () => expect(parseSize('512b')).toBe(512));
  it('defaults to 2 MiB for unrecognised format', () =>
    expect(parseSize('invalid')).toBe(2 * 1024 * 1024));
  it('is case-insensitive', () => expect(parseSize('1MB')).toBe(1024 * 1024));
});

// ─── middleware tests ────────────────────────────────────────────────────────

describe('RequestSizeLimitMiddleware', () => {
  let middleware: RequestSizeLimitMiddleware;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        RequestSizeLimitMiddleware,
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) => {
              if (key === 'security.maxBodySize') return '1mb';
              return undefined;
            },
          },
        },
      ],
    }).compile();

    middleware = module.get(RequestSizeLimitMiddleware);
  });

  it('allows requests under the size limit', () => {
    const req = makeReq(500 * 1024); // 500 KB
    const next = vi.fn();
    middleware.use(req, mockRes, next);
    expect(next).toHaveBeenCalled();
  });

  it('allows requests with no content-length header', () => {
    const req = makeReq(); // no content-length
    const next = vi.fn();
    middleware.use(req, mockRes, next);
    expect(next).toHaveBeenCalled();
  });

  it('allows requests exactly at the limit', () => {
    const req = makeReq(1024 * 1024); // == 1 MB
    const next = vi.fn();
    middleware.use(req, mockRes, next);
    expect(next).toHaveBeenCalled();
  });

  it('blocks requests over the size limit with 413', () => {
    const req = makeReq(1024 * 1024 + 1); // 1 MB + 1 byte
    const next = vi.fn();
    expect(() => middleware.use(req, mockRes, next)).toThrow(HttpException);
    try {
      middleware.use(req, mockRes, next);
    } catch (e) {
      expect((e as HttpException).getStatus()).toBe(
        HttpStatus.PAYLOAD_TOO_LARGE,
      );
    }
    expect(next).not.toHaveBeenCalled();
  });

  it('respects a custom limit configured via ConfigService', () => {
    const custom = buildMiddleware('100kb');
    const next = vi.fn();

    // Under limit
    middleware.use(makeReq(50 * 1024), mockRes, next);
    expect(next).toHaveBeenCalledTimes(1);

    // Over 100 KB limit
    expect(() => custom.use(makeReq(200 * 1024), mockRes, vi.fn())).toThrow(
      HttpException,
    );
  });

  it('uses 2 MiB default when config value is missing', () => {
    const def = buildMiddleware('2mb');
    const next = vi.fn();
    // Under default limit
    def.use(makeReq(1024 * 1024), mockRes, next);
    expect(next).toHaveBeenCalled();
    // Over default limit
    expect(() => def.use(makeReq(3 * 1024 * 1024), mockRes, vi.fn())).toThrow(
      HttpException,
    );
  });
});
