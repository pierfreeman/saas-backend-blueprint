import {
  RequirePermissions,
  PERMISSIONS_KEY,
  PermissionMode,
  PermissionsMetadata,
} from './require-permissions.decorator';
import { vi } from 'vitest';

// Mock SetMetadata to capture what's being set
let capturedKey: string | undefined;
let capturedValue: PermissionsMetadata | undefined;

vi.mock('@nestjs/common', async (importActual) => {
  const actual = await importActual<typeof import('@nestjs/common')>();
  return {
    ...actual,
    SetMetadata: (key: string, value: PermissionsMetadata) => {
      capturedKey = key;
      capturedValue = value;
      return actual.SetMetadata(key, value);
    },
  };
});

describe('RequirePermissions decorator', () => {
  beforeEach(() => {
    capturedKey = undefined;
    capturedValue = undefined;
  });

  it('calls SetMetadata with the correct key and default mode ANY', () => {
    RequirePermissions(['org.read', 'org.manage']);

    expect(capturedKey).toBe(PERMISSIONS_KEY);
    expect(capturedValue).toEqual({
      permissions: ['org.read', 'org.manage'],
      mode: 'ANY',
    });
  });

  it('calls SetMetadata with mode ALL when specified', () => {
    RequirePermissions(['org.read', 'org.manage'], 'ALL');

    expect(capturedKey).toBe(PERMISSIONS_KEY);
    expect(capturedValue).toEqual({
      permissions: ['org.read', 'org.manage'],
      mode: 'ALL',
    });
  });

  it('handles a single permission', () => {
    RequirePermissions(['org.read']);

    expect(capturedValue).toEqual({
      permissions: ['org.read'],
      mode: 'ANY',
    });
  });

  it('handles multiple permissions with ANY mode', () => {
    RequirePermissions(['perm1', 'perm2', 'perm3'], 'ANY');

    expect(capturedValue).toEqual({
      permissions: ['perm1', 'perm2', 'perm3'],
      mode: 'ANY',
    });
  });

  it('exports the correct metadata key', () => {
    expect(PERMISSIONS_KEY).toBe('rbac:permissions');
  });

  it('returns a decorator function', () => {
    const decorator = RequirePermissions(['org.read']);
    expect(typeof decorator).toBe('function');
  });
});
