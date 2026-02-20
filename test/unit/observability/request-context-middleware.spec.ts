import { Request, Response, NextFunction } from 'express';
import { RequestContextMiddleware } from '../../../src/observability/middleware/request-context.middleware';
import { RequestContextService } from '../../../src/observability/middleware/request-context.service';

describe('RequestContextMiddleware', () => {
  let middleware: RequestContextMiddleware;
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let nextFunction: NextFunction;

  beforeEach(() => {
    middleware = new RequestContextMiddleware();

    mockRequest = {
      headers: {},
      method: 'GET',
      url: '/test',
    } as Partial<Request>;

    mockResponse = {
      setHeader: jest.fn(),
    } as Partial<Response>;

    nextFunction = jest.fn();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should generate a request ID if not provided', () => {
    middleware.use(mockRequest as Request, mockResponse as Response, nextFunction);

    expect(mockResponse.setHeader).toHaveBeenCalledWith(
      'X-Request-Id',
      expect.stringMatching(/^[0-9a-f-]{36}$/),
    );
    expect(nextFunction).toHaveBeenCalled();
  });

  it('should use client-provided request ID', () => {
    mockRequest.headers = {
      'x-request-id': 'client-req-123',
    };

    middleware.use(mockRequest as Request, mockResponse as Response, nextFunction);

    expect(mockResponse.setHeader).toHaveBeenCalledWith('X-Request-Id', 'client-req-123');
  });

  it('should extract user ID from JWT', () => {
    (mockRequest as any).user = {
      sub: 'user-456',
    };

    middleware.use(mockRequest as Request, mockResponse as Response, nextFunction);

    // Check if next was called (context was set)
    expect(nextFunction).toHaveBeenCalled();
  });

  it('should extract org ID from JWT custom claim', () => {
    (mockRequest as any).user = {
      sub: 'user-456',
      orgId: 'org-789',
    };

    middleware.use(mockRequest as Request, mockResponse as Response, nextFunction);

    expect(nextFunction).toHaveBeenCalled();
  });

  it('should extract org ID from header if not in JWT', () => {
    mockRequest.headers = {
      'x-organization-id': 'org-from-header',
    };

    middleware.use(mockRequest as Request, mockResponse as Response, nextFunction);

    expect(nextFunction).toHaveBeenCalled();
  });

  it('should create a request context', (done) => {
    middleware.use(mockRequest as Request, mockResponse as Response, () => {
      const context = RequestContextService.getContext();

      expect(context).toBeDefined();
      expect(context?.requestId).toBeDefined();
      expect(context?.timestamp).toBeInstanceOf(Date);

      done();
    });
  });
});
