/**
 * RBAC Event Types for WebSocket notifications
 */
export enum RBACEventType {
  ROLE_CHANGED = 'rbac.role.changed',
  MEMBERSHIP_STATUS_CHANGED = 'rbac.membership.status.changed',
  PERMISSIONS_UPDATED = 'rbac.permissions.updated',
  CACHE_INVALIDATED = 'rbac.cache.invalidated',
}

export interface RBACRoleChangedEvent {
  userId: string;
  orgId: string;
  oldRole: string;
  newRole: string;
  timestamp: Date;
}

export interface RBACMembershipStatusChangedEvent {
  userId: string;
  orgId: string;
  oldStatus: string;
  newStatus: string;
  timestamp: Date;
}

export interface RBACPermissionsUpdatedEvent {
  role?: string;
  affectedUserIds?: string[];
  orgId?: string;
  timestamp: Date;
}

export interface RBACCacheInvalidatedEvent {
  userId?: string;
  orgId?: string;
  scope: 'user' | 'org' | 'global';
  timestamp: Date;
}
