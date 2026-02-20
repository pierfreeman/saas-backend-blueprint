import { PayloadSanitizationMiddleware } from '../../../src/modules/security/middleware/payload-sanitization.middleware';
import { SecurityIncidentException } from '../../../src/modules/security/services/security-incident.exception';
import { SecurityRequest } from '../../../src/modules/security/types/security-request.interface';

describe('PayloadSanitizationMiddleware', () => {
  const middleware = new PayloadSanitizationMiddleware({
    attachReason: jest.fn(),
    registerSuspiciousActivity: jest.fn(),
  } as never);

  it('should sanitize xss payloads in request body', () => {
    const request = {
      path: '/players',
      body: {
        bio: '<script>alert(1)</script>Hello',
      },
      query: {},
      params: {},
    } as SecurityRequest;

    const next = jest.fn();
    middleware.use(request, {} as never, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(request.body.bio).toBe('Hello');
  });

  it('should block payload with nosql operator keys', () => {
    const request = {
      path: '/players',
      body: {
        $where: 'this.password.length > 0',
      },
      query: {},
      params: {},
    } as SecurityRequest;

    expect(() => middleware.use(request, {} as never, jest.fn())).toThrow(
      SecurityIncidentException,
    );
  });
});
