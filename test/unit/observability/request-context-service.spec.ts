import {
  RequestContextService,
  RequestContext,
} from '../../../src/observability/middleware/request-context.service';

describe('RequestContextService', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('run', () => {
    it('should run callback within a context', () => {
      const context: RequestContext = {
        requestId: 'req-123',
        userId: 'user-456',
        timestamp: new Date(),
      };

      let capturedContext: RequestContext | undefined;

      RequestContextService.run(context, () => {
        capturedContext = RequestContextService.getContext();
      });

      expect(capturedContext).toEqual(context);
    });

    it('should return callback result', () => {
      const context: RequestContext = {
        requestId: 'req-123',
        timestamp: new Date(),
      };

      const result = RequestContextService.run(context, () => {
        return 'test-result';
      });

      expect(result).toBe('test-result');
    });
  });

  describe('getContext', () => {
    it('should return undefined outside of context', () => {
      const context = RequestContextService.getContext();
      expect(context).toBeUndefined();
    });

    it('should return context when running inside context', () => {
      const expectedContext: RequestContext = {
        requestId: 'req-123',
        userId: 'user-456',
        orgId: 'org-789',
        timestamp: new Date(),
      };

      RequestContextService.run(expectedContext, () => {
        const context = RequestContextService.getContext();
        expect(context).toEqual(expectedContext);
      });
    });
  });

  describe('getRequestId', () => {
    it('should return request ID from context', () => {
      const context: RequestContext = {
        requestId: 'req-123',
        timestamp: new Date(),
      };

      RequestContextService.run(context, () => {
        const requestId = RequestContextService.getRequestId();
        expect(requestId).toBe('req-123');
      });
    });

    it('should return undefined outside context', () => {
      const requestId = RequestContextService.getRequestId();
      expect(requestId).toBeUndefined();
    });
  });

  describe('getUserId', () => {
    it('should return user ID from context', () => {
      const context: RequestContext = {
        requestId: 'req-123',
        userId: 'user-456',
        timestamp: new Date(),
      };

      RequestContextService.run(context, () => {
        const userId = RequestContextService.getUserId();
        expect(userId).toBe('user-456');
      });
    });

    it('should return undefined when user ID not in context', () => {
      const context: RequestContext = {
        requestId: 'req-123',
        timestamp: new Date(),
      };

      RequestContextService.run(context, () => {
        const userId = RequestContextService.getUserId();
        expect(userId).toBeUndefined();
      });
    });
  });

  describe('getOrgId', () => {
    it('should return org ID from context', () => {
      const context: RequestContext = {
        requestId: 'req-123',
        orgId: 'org-789',
        timestamp: new Date(),
      };

      RequestContextService.run(context, () => {
        const orgId = RequestContextService.getOrgId();
        expect(orgId).toBe('org-789');
      });
    });
  });

  describe('updateContext', () => {
    it('should update existing context', () => {
      const context: RequestContext = {
        requestId: 'req-123',
        timestamp: new Date(),
      };

      RequestContextService.run(context, () => {
        RequestContextService.updateContext({
          userId: 'user-456',
          orgId: 'org-789',
        });

        const updated = RequestContextService.getContext();
        expect(updated?.userId).toBe('user-456');
        expect(updated?.orgId).toBe('org-789');
        expect(updated?.requestId).toBe('req-123');
      });
    });

    it('should do nothing when called outside context', () => {
      expect(() => {
        RequestContextService.updateContext({ userId: 'user-456' });
      }).not.toThrow();
    });
  });
});
