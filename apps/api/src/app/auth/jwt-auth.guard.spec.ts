import { JwtAuthGuard } from './jwt-auth.guard';
import { ExecutionContext, UnauthorizedException } from '@nestjs/common';

// Stub the Passport AuthGuard base class to avoid real JWT processing
jest.mock('@nestjs/passport', () => ({
  AuthGuard: () => {
    class MockAuthGuard {
      canActivate(_ctx: ExecutionContext): boolean {
        return true;
      }
    }
    return MockAuthGuard;
  },
}));

describe('JwtAuthGuard', () => {
  let guard: JwtAuthGuard;

  beforeEach(() => {
    guard = new JwtAuthGuard();
  });

  describe('handleRequest', () => {
    it('returns the user when no error and user is present', () => {
      const user = { sub: 'auth0|1', email: 'a@b.com' };
      expect(guard.handleRequest(null, user)).toBe(user);
    });

    it('throws the original error when err is provided', () => {
      const err = new UnauthorizedException('token expired');
      expect(() => guard.handleRequest(err, null)).toThrow(
        UnauthorizedException,
      );
    });

    it('throws UnauthorizedException when user is falsy and no error', () => {
      expect(() => guard.handleRequest(null, null)).toThrow(
        UnauthorizedException,
      );
      expect(() => guard.handleRequest(null, undefined)).toThrow(
        UnauthorizedException,
      );
      expect(() => guard.handleRequest(null, false)).toThrow(
        UnauthorizedException,
      );
    });

    it('throws the provided error even if user is also present', () => {
      const err = new Error('Something went wrong');
      expect(() =>
        guard.handleRequest(err, { sub: 'auth0|1', email: 'a@b.com' }),
      ).toThrow('Something went wrong');
    });

    it('passes through any user shape (truthy check only)', () => {
      expect(guard.handleRequest(null, 'any-truthy-value')).toBe(
        'any-truthy-value',
      );
      expect(guard.handleRequest(null, 42)).toBe(42);
    });
  });

  describe('canActivate', () => {
    it('delegates to parent canActivate', () => {
      const ctx = {} as ExecutionContext;
      // The mocked parent always returns true
      expect(guard.canActivate(ctx)).toBe(true);
    });
  });
});
