import { RequireRole, REQUIRE_ROLE_KEY } from './require-role.decorator';
import { MembershipRole } from '@prisma/client';
import { Reflector } from '@nestjs/core';

function applyToMethod(
  decorator: MethodDecorator,
): MembershipRole[] | undefined {
  class Target {
    handler() {
      return;
    }
  }
  const descriptor = Object.getOwnPropertyDescriptor(
    Target.prototype,
    'handler',
  )!;
  decorator(Target.prototype, 'handler', descriptor);
  return new Reflector().get<MembershipRole[]>(
    REQUIRE_ROLE_KEY,
    Target.prototype.handler,
  );
}

describe('RequireRole decorator', () => {
  it('stores a single role under REQUIRE_ROLE_KEY', () => {
    const roles = applyToMethod(RequireRole('OWNER'));
    expect(roles).toEqual(['OWNER']);
  });

  it('stores multiple roles under REQUIRE_ROLE_KEY', () => {
    const roles = applyToMethod(RequireRole('OWNER', 'ADMIN'));
    expect(roles).toEqual(['OWNER', 'ADMIN']);
  });

  it('stores all four membership roles', () => {
    const roles = applyToMethod(
      RequireRole('OWNER', 'ADMIN', 'MEMBER', 'READ_ONLY'),
    );
    expect(roles).toEqual(['OWNER', 'ADMIN', 'MEMBER', 'READ_ONLY']);
  });

  it('can be called with no roles (empty varargs)', () => {
    const roles = applyToMethod(RequireRole());
    expect(roles).toEqual([]);
  });

  it('REQUIRE_ROLE_KEY constant has the expected value', () => {
    expect(REQUIRE_ROLE_KEY).toBe('rbac:require-role');
  });

  it('each invocation is independent (no shared state)', () => {
    class A {
      handlerA() {
        return;
      }
    }
    class B {
      handlerB() {
        return;
      }
    }
    const decA = RequireRole('OWNER');
    const decB = RequireRole('MEMBER');

    decA(
      A.prototype,
      'handlerA',
      Object.getOwnPropertyDescriptor(A.prototype, 'handlerA')!,
    );
    decB(
      B.prototype,
      'handlerB',
      Object.getOwnPropertyDescriptor(B.prototype, 'handlerB')!,
    );

    const reflector = new Reflector();
    expect(
      reflector.get<MembershipRole[]>(REQUIRE_ROLE_KEY, A.prototype.handlerA),
    ).toEqual(['OWNER']);
    expect(
      reflector.get<MembershipRole[]>(REQUIRE_ROLE_KEY, B.prototype.handlerB),
    ).toEqual(['MEMBER']);
  });
});
