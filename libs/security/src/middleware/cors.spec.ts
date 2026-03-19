import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { CorsMiddleware } from './cors.middleware';
import type { Request, Response } from 'express';

function makeReq(origin?: string, method = 'GET'): Partial<Request> {
  return {
    headers: origin ? { origin } : {},
    method,
  };
}

function makeRes(): {
  res: Partial<Response>;
  headers: Record<string, string>;
  statusCode: number;
  ended: boolean;
} {
  const headers: Record<string, string> = {};
  let statusCode = 200;
  let ended = false;

  const res: Partial<Response> = {
    setHeader: jest.fn((key: string, val: string) => {
      headers[key.toLowerCase()] = val;
      return res as Response;
    }),
    status: jest.fn((code: number) => {
      statusCode = code;
      return res as Response;
    }),
    end: jest.fn(() => {
      ended = true;
      return res as Response;
    }),
    json: jest.fn((body) => {
      statusCode = (body as { statusCode: number }).statusCode;
      ended = true;
      return res as Response;
    }),
  };

  return {
    res,
    headers,
    get statusCode() {
      return statusCode;
    },
    get ended() {
      return ended;
    },
  };
}

describe('CorsMiddleware', () => {
  let middleware: CorsMiddleware;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CorsMiddleware,
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) => {
              const config: Record<string, unknown> = {
                'security.cors.allowedOrigins': [
                  'https://app.example.com',
                  'https://admin.example.com',
                ],
                'security.cors.credentials': true,
              };
              return config[key];
            },
          },
        },
      ],
    }).compile();

    middleware = module.get(CorsMiddleware);
  });

  describe('Allowed origins', () => {
    it('sets Access-Control-Allow-Origin for a listed origin', () => {
      const req = makeReq('https://app.example.com');
      const { res, headers } = makeRes();
      const next = jest.fn();

      middleware.use(req as Request, res as Response, next);

      expect(headers['access-control-allow-origin']).toBe(
        'https://app.example.com',
      );
      expect(next).toHaveBeenCalled();
    });

    it('sets Access-Control-Allow-Credentials when credentials=true', () => {
      const req = makeReq('https://app.example.com');
      const { res, headers } = makeRes();
      middleware.use(req as Request, res as Response, jest.fn());

      expect(headers['access-control-allow-credentials']).toBe('true');
    });

    it('responds 204 to preflight OPTIONS from allowed origin', () => {
      const req = makeReq('https://admin.example.com', 'OPTIONS');
      const state = makeRes();

      middleware.use(req as Request, state.res as Response, jest.fn());

      expect(state.statusCode).toBe(204);
      expect(state.ended).toBe(true);
    });
  });

  describe('Blocked origins', () => {
    it('responds 403 to a disallowed origin', () => {
      const req = makeReq('https://evil.attacker.com');
      const state = makeRes();

      middleware.use(req as Request, state.res as Response, jest.fn());

      expect(state.statusCode).toBe(403);
      expect(state.ended).toBe(true);
    });

    it('responds 403 to OPTIONS preflight from disallowed origin', () => {
      const req = makeReq('https://evil.attacker.com', 'OPTIONS');
      const state = makeRes();

      middleware.use(req as Request, state.res as Response, jest.fn());

      expect(state.statusCode).toBe(403);
      expect(state.ended).toBe(true);
    });

    it('does NOT call next() for a blocked origin', () => {
      const req = makeReq('https://evil.attacker.com');
      const next = jest.fn();
      middleware.use(req as Request, makeRes().res as Response, next);

      expect(next).not.toHaveBeenCalled();
    });
  });

  describe('No Origin header (server-to-server)', () => {
    it('passes through requests without an Origin header', () => {
      const req = makeReq(); // no origin
      const next = jest.fn();
      middleware.use(req as Request, makeRes().res as Response, next);

      expect(next).toHaveBeenCalled();
    });
  });
});
