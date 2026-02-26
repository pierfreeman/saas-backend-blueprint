/**
 * Coverage spec for rbac/index.ts
 *
 * This barrel re-exports every public symbol from the RBAC subsystem.
 * Importing it and asserting that the key symbols are defined is enough to
 * execute all re-export statements and bring coverage to 100%.
 */
import * as RbacIndex from './index';

describe('rbac/index barrel', () => {
  // -- module + services --
  it('exports RBACModule', () => {
    expect(RbacIndex.RBACModule).toBeDefined();
  });

  it('exports RBACService', () => {
    expect(RbacIndex.RBACService).toBeDefined();
  });

  it('exports RBACCacheService', () => {
    expect(RbacIndex.RBACCacheService).toBeDefined();
  });

  it('exports PermissionResolverService', () => {
    expect(RbacIndex.PermissionResolverService).toBeDefined();
  });

  // -- guards --
  it('exports OrgContextGuard', () => {
    expect(RbacIndex.OrgContextGuard).toBeDefined();
  });

  it('exports RBACGuard', () => {
    expect(RbacIndex.RBACGuard).toBeDefined();
  });

  // -- decorators --
  it('exports OrgScoped', () => {
    expect(RbacIndex.OrgScoped).toBeDefined();
  });

  it('exports ORG_SCOPED_KEY', () => {
    expect(RbacIndex.ORG_SCOPED_KEY).toBe('rbac:org-scoped');
  });

  it('exports RequirePermissions', () => {
    expect(RbacIndex.RequirePermissions).toBeDefined();
  });

  it('exports PERMISSIONS_KEY', () => {
    expect(RbacIndex.PERMISSIONS_KEY).toBe('rbac:permissions');
  });

  it('exports RequireRole', () => {
    expect(RbacIndex.RequireRole).toBeDefined();
  });

  it('exports REQUIRE_ROLE_KEY', () => {
    expect(RbacIndex.REQUIRE_ROLE_KEY).toBe('rbac:require-role');
  });

  it('exports CurrentUserId decorator', () => {
    expect(RbacIndex.CurrentUserId).toBeDefined();
  });

  it('exports CurrentOrgId decorator', () => {
    expect(RbacIndex.CurrentOrgId).toBeDefined();
  });

  it('exports RBACContext decorator', () => {
    expect(RbacIndex.RBACContext).toBeDefined();
  });

  // -- re-exported constants from @libs/common --
  it('exports PERMISSIONS from @libs/common', () => {
    expect(RbacIndex.PERMISSIONS).toBeDefined();
    expect(typeof RbacIndex.PERMISSIONS.ORG_READ).toBe('string');
  });

  it('exports ROLES from @libs/common', () => {
    expect(RbacIndex.ROLES).toBeDefined();
    expect(RbacIndex.ROLES.OWNER).toBe('OWNER');
  });

  it('exports ROLE_HIERARCHY from @libs/common', () => {
    expect(Array.isArray(RbacIndex.ROLE_HIERARCHY)).toBe(true);
    expect(RbacIndex.ROLE_HIERARCHY.length).toBeGreaterThan(0);
  });

  it('exports ROLE_PERMISSIONS from @libs/common', () => {
    expect(RbacIndex.ROLE_PERMISSIONS).toBeDefined();
    expect(Array.isArray(RbacIndex.ROLE_PERMISSIONS['OWNER'])).toBe(true);
  });

  it('exports isRoleHigherOrEqual from @libs/common', () => {
    expect(typeof RbacIndex.isRoleHigherOrEqual).toBe('function');
    expect(RbacIndex.isRoleHigherOrEqual('OWNER', 'ADMIN')).toBe(true);
    expect(RbacIndex.isRoleHigherOrEqual('MEMBER', 'OWNER')).toBe(false);
  });
});
