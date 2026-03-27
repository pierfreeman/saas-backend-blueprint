import { Test, TestingModule } from '@nestjs/testing';
import { SentryService } from './sentry.service';
import * as Sentry from '@sentry/node';
import { Mock, vi } from 'vitest';

// vi.mock is hoisted before ALL variable declarations, so we cannot reference
// file-level variables inside the factory. Instead, mock withScope as a plain vi.fn()
// and configure it in beforeEach using mockImplementation.
vi.mock('@sentry/node', () => ({
  withScope: vi.fn(),
  captureException: vi.fn(),
  captureMessage: vi.fn(),
  logger: {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
  getCurrentScope: vi.fn(),
}));

const mockScope = {
  setUser: vi.fn(),
  setTag: vi.fn(),
};

describe('SentryService', () => {
  let service: SentryService;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Configure withScope to synchronously call its callback with mockScope
    (Sentry.withScope as Mock).mockImplementation(
      (cb: (scope: typeof mockScope) => void) => cb(mockScope),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [SentryService],
    }).compile();

    service = module.get<SentryService>(SentryService);
  });

  afterEach(() => vi.clearAllMocks());

  describe('captureException', () => {
    it('calls Sentry.withScope and Sentry.captureException', () => {
      const err = new Error('test error');
      service.captureException(err);

      expect(Sentry.withScope).toHaveBeenCalledTimes(1);
      expect(Sentry.captureException).toHaveBeenCalledWith(err);
    });

    it('sets tenantId tag when provided', () => {
      service.captureException(new Error('err'), { tenantId: 'tid-42' });

      expect(mockScope.setTag).toHaveBeenCalledWith('tenantId', 'tid-42');
    });

    it('sets orgId tag when provided', () => {
      service.captureException(new Error('err'), { orgId: 'org-99' });

      expect(mockScope.setTag).toHaveBeenCalledWith('orgId', 'org-99');
    });

    it('sets actorRole tag when provided', () => {
      service.captureException(new Error('err'), { actorRole: 'OWNER' });

      expect(mockScope.setTag).toHaveBeenCalledWith('actorRole', 'OWNER');
    });

    it('sets Sentry user with only ID — no PII (no email)', () => {
      service.captureException(new Error('err'), { userId: 'user-uuid-123' });

      const setUserCall = mockScope.setUser.mock.calls[0][0] as { id: string };
      expect(setUserCall.id).toBe('user-uuid-123');
      // Ensure no email field is set
      expect((setUserCall as Record<string, unknown>)['email']).toBeUndefined();
    });

    it('does not call setUser when userId is absent', () => {
      service.captureException(new Error('err'), { tenantId: 'tid-1' });
      expect(mockScope.setUser).not.toHaveBeenCalled();
    });

    it('works with no context', () => {
      expect(() => service.captureException(new Error('err'))).not.toThrow();
      expect(Sentry.captureException).toHaveBeenCalledTimes(1);
    });

    it('captures non-Error unknowns without throwing', () => {
      expect(() => service.captureException('string error', {})).not.toThrow();
      expect(Sentry.captureException).toHaveBeenCalledTimes(1);
    });
  });

  describe('captureMessage', () => {
    it('calls Sentry.captureMessage with info level by default', () => {
      service.captureMessage('something happened');

      expect(Sentry.captureMessage).toHaveBeenCalledWith(
        'something happened',
        'info',
      );
    });

    it('passes custom level through', () => {
      service.captureMessage('degraded', 'warning', { tenantId: 'tid-5' });

      expect(Sentry.captureMessage).toHaveBeenCalledWith('degraded', 'warning');
      expect(mockScope.setTag).toHaveBeenCalledWith('tenantId', 'tid-5');
    });
  });

  describe('withScope', () => {
    it('executes callback with Sentry.withScope', () => {
      const cb = vi.fn();
      service.withScope(cb);
      expect(Sentry.withScope).toHaveBeenCalledTimes(1);
    });
  });
});
