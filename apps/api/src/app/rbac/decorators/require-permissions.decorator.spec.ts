import { SetMetadata } from '@nestjs/common';
import {
  RequirePermissions,
  PERMISSIONS_KEY,
  PermissionsMetadata,
} from './require-permissions.decorator';
import { PERMISSIONS } from '@libs/common';
import { Reflector } from '@nestjs/core';

// -----------------------------------------------------------------------
// Utility: apply a decorator to a dummy class/method and read back metadata
// -----------------------------------------------------------------------
function applyToMethod(decorator: MethodDecorator) {
  class Target {
    handler() {}
  }
  const descriptor = Object.getOwnPropertyDescriptor(
    Target.prototype,
    'handler',
  )!;
  decorator(Target.prototype, 'handler', descriptor);
  return new Reflector().get<PermissionsMetadata>(
    PERMISSIONS_KEY,
    Target.prototype.handler,
  );
}

describe('RequirePermissions decorator', () => {
  it('stores the permissions array under PERMISSIONS_KEY', () => {
    const meta = applyToMethod(
      RequirePermissions([PERMISSIONS.ORG_READ, PERMISSIONS.ORG_MANAGE]),
    );
    expect(meta.permissions).toEqual([
      PERMISSIONS.ORG_READ,
      PERMISSIONS.ORG_MANAGE,
    ]);
  });

  it('defaults mode to "ANY" when not specified', () => {
    const meta = applyToMethod(RequirePermissions([PERMISSIONS.ORG_READ]));
    expect(meta.mode).toBe('ANY');
  });

  it('uses the provided mode "ALL"', () => {
    const meta = applyToMethod(
      RequirePermissions([PERMISSIONS.ORG_MANAGE], 'ALL'),
    );
    expect(meta.mode).toBe('ALL');
  });

  it('uses the provided mode "ANY" explicitly', () => {
    const meta = applyToMethod(
      RequirePermissions([PERMISSIONS.ORG_READ], 'ANY'),
    );
    expect(meta.mode).toBe('ANY');
  });

  it('can store an empty permissions array', () => {
    const meta = applyToMethod(RequirePermissions([]));
    expect(meta.permissions).toEqual([]);
    expect(meta.mode).toBe('ANY');
  });

  it('accepts arbitrary string permissions alongside typed PermissionKey values', () => {
    const meta = applyToMethod(
      RequirePermissions([PERMISSIONS.ORG_READ, 'custom.permission.x']),
    );
    expect(meta.permissions).toContain('custom.permission.x');
    expect(meta.permissions).toContain(PERMISSIONS.ORG_READ);
  });

  it('PERMISSIONS_KEY constant has the expected value', () => {
    expect(PERMISSIONS_KEY).toBe('rbac:permissions');
  });
});
