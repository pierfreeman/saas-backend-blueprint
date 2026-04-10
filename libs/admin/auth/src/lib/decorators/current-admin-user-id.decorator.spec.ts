import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { ExecutionContext } from '@nestjs/common';
import { Controller, Get } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { CurrentAdminUserId } from './current-admin-user-id.decorator';

/**
 * Retrieves the factory registered by createParamDecorator.
 * NestJS stores param metadata on the target class method under ROUTE_ARGS_METADATA.
 */
function getDecoratorFactory(
  decorator: () => ParameterDecorator,
): (data: unknown, ctx: ExecutionContext) => string | undefined {
  @Controller()
  class TestController {
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    @Get()
    handler(@decorator() _id: string): void {} // eslint-disable-line @typescript-eslint/no-unused-vars
  }

  const args = Reflect.getMetadata(
    ROUTE_ARGS_METADATA,
    TestController,
    'handler',
  );
  const entry = Object.values(args)[0] as {
    factory: (data: unknown, ctx: ExecutionContext) => string | undefined;
  };
  return entry.factory;
}

function makeContext(user?: unknown): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ user }),
    }),
  } as unknown as ExecutionContext;
}

describe('CurrentAdminUserId', () => {
  const factory = getDecoratorFactory(CurrentAdminUserId);

  it('returns the adminUserId when present', () => {
    const ctx = makeContext({ adminUserId: 'admin-uuid-123' });
    expect(factory(undefined, ctx)).toBe('admin-uuid-123');
  });

  it('returns undefined when request.user is absent', () => {
    const ctx = makeContext(undefined);
    expect(factory(undefined, ctx)).toBeUndefined();
  });

  it('returns undefined when adminUserId is absent from user', () => {
    const ctx = makeContext({});
    expect(factory(undefined, ctx)).toBeUndefined();
  });
});
