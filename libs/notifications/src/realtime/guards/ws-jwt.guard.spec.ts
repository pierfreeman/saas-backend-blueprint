import { WsJwtGuard } from './ws-jwt.guard';
import { ExecutionContext } from '@nestjs/common';

function makeContext(userId?: string): ExecutionContext {
  return {
    switchToWs: () => ({
      getClient: () => ({ userId }),
    }),
  } as unknown as ExecutionContext;
}

describe('WsJwtGuard', () => {
  let guard: WsJwtGuard;

  beforeEach(() => {
    guard = new WsJwtGuard();
  });

  it('returns true when socket has userId attached', () => {
    expect(guard.canActivate(makeContext('user-abc'))).toBe(true);
  });

  it('returns false when userId is undefined', () => {
    expect(guard.canActivate(makeContext(undefined))).toBe(false);
  });

  it('returns false when userId is empty string', () => {
    expect(guard.canActivate(makeContext(''))).toBe(false);
  });
});
