import { OrgScoped, ORG_SCOPED_KEY } from './org-scoped.decorator';
import { Reflector } from '@nestjs/core';

function applyToClass(decorator: ClassDecorator): boolean | undefined {
  @decorator
  class Target {}
  return new Reflector().get<boolean>(ORG_SCOPED_KEY, Target);
}

function applyToMethod(decorator: MethodDecorator): boolean | undefined {
  class Target {
    handler() {}
  }
  const descriptor = Object.getOwnPropertyDescriptor(
    Target.prototype,
    'handler',
  )!;
  decorator(Target.prototype, 'handler', descriptor);
  return new Reflector().get<boolean>(ORG_SCOPED_KEY, Target.prototype.handler);
}

describe('OrgScoped decorator', () => {
  it('sets ORG_SCOPED_KEY to true on a class', () => {
    expect(applyToClass(OrgScoped() as ClassDecorator)).toBe(true);
  });

  it('sets ORG_SCOPED_KEY to true on a method', () => {
    expect(applyToMethod(OrgScoped() as unknown as MethodDecorator)).toBe(true);
  });

  it('ORG_SCOPED_KEY constant has the expected value', () => {
    expect(ORG_SCOPED_KEY).toBe('rbac:org-scoped');
  });

  it('calling OrgScoped() twice produces independent decorators', () => {
    const dec1 = OrgScoped() as ClassDecorator;
    const dec2 = OrgScoped() as ClassDecorator;

    @dec1
    class A {}

    @dec2
    class B {}

    const reflector = new Reflector();
    expect(reflector.get<boolean>(ORG_SCOPED_KEY, A)).toBe(true);
    expect(reflector.get<boolean>(ORG_SCOPED_KEY, B)).toBe(true);
  });
});
