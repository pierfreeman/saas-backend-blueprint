// Module
export * from './rbac.module';

// Services
export * from './services/rbac.service';
export * from './services/rbac-cache.service';
export * from './services/permission-resolver.service';

// Guards
export * from './guards/org-context.guard';
export * from './guards/rbac.guard';

// Decorators
export * from './decorators/org-scoped.decorator';
export * from './decorators/allow-suspended.decorator';
export * from './decorators/rbac-context.decorator';
export * from './decorators/require-permissions.decorator';
export * from './decorators/require-role.decorator';

// Constants (re-exported from @libs/common for convenience)
export {
  PERMISSIONS,
  PermissionKey,
  ROLES,
  ROLE_HIERARCHY,
  isRoleHigherOrEqual,
  ROLE_PERMISSIONS,
} from '@libs/common';
