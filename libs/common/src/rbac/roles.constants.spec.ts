import {
  isRoleHigherOrEqual,
  ROLE_HIERARCHY,
  ROLE_PERMISSIONS,
  ROLES,
} from './roles.constants';
import { PERMISSIONS } from './permissions.constants';
import { MembershipRole } from '@libs/prisma-business';

describe('isRoleHigherOrEqual', () => {
  it('returns true when roles are equal', () => {
    expect(isRoleHigherOrEqual('OWNER', 'OWNER')).toBe(true);
    expect(isRoleHigherOrEqual('MEMBER', 'MEMBER')).toBe(true);
  });

  it('returns true when user role is higher than required', () => {
    expect(isRoleHigherOrEqual('OWNER', 'ADMIN')).toBe(true);
    expect(isRoleHigherOrEqual('ADMIN', 'MEMBER')).toBe(true);
    expect(isRoleHigherOrEqual('MEMBER', 'READ_ONLY')).toBe(true);
    expect(isRoleHigherOrEqual('OWNER', 'READ_ONLY')).toBe(true);
  });

  it('returns false when user role is lower than required', () => {
    expect(isRoleHigherOrEqual('READ_ONLY', 'MEMBER')).toBe(false);
    expect(isRoleHigherOrEqual('MEMBER', 'ADMIN')).toBe(false);
    expect(isRoleHigherOrEqual('ADMIN', 'OWNER')).toBe(false);
  });

  it('returns false for unknown roles', () => {
    expect(isRoleHigherOrEqual('UNKNOWN' as MembershipRole, 'OWNER')).toBe(
      false,
    );
    expect(isRoleHigherOrEqual('OWNER', 'UNKNOWN' as MembershipRole)).toBe(
      false,
    );
  });
});

describe('ROLE_HIERARCHY', () => {
  it('is ordered from lowest to highest', () => {
    expect(ROLE_HIERARCHY).toEqual(['READ_ONLY', 'MEMBER', 'ADMIN', 'OWNER']);
  });
});

describe('ROLE_PERMISSIONS', () => {
  it('OWNER has all permissions', () => {
    const ownerPerms = ROLE_PERMISSIONS['OWNER'];
    expect(ownerPerms).toContain(PERMISSIONS.ORG_MANAGE);
    expect(ownerPerms).toContain(PERMISSIONS.ORG_BILLING_MANAGE);
    expect(ownerPerms).toContain(PERMISSIONS.ORG_MEMBERS_INVITE);
    expect(ownerPerms).toContain(PERMISSIONS.ORG_MEMBERS_REMOVE);
    expect(ownerPerms).toContain(PERMISSIONS.ORG_MEMBERS_ROLE_UPDATE);
    expect(ownerPerms).toContain(PERMISSIONS.ORG_READ);
    expect(ownerPerms).toContain(PERMISSIONS.ANALYTICS_VIEW);
    expect(ownerPerms).toContain(PERMISSIONS.ANALYTICS_EXPORT);
  });

  it('ADMIN cannot manage billing or export analytics', () => {
    const adminPerms = ROLE_PERMISSIONS['ADMIN'];
    expect(adminPerms).not.toContain(PERMISSIONS.ORG_BILLING_MANAGE);
    expect(adminPerms).not.toContain(PERMISSIONS.ANALYTICS_EXPORT);
    expect(adminPerms).toContain(PERMISSIONS.ORG_MANAGE);
  });

  it('MEMBER can only read and view analytics', () => {
    const memberPerms = ROLE_PERMISSIONS['MEMBER'];
    expect(memberPerms).toContain(PERMISSIONS.ORG_READ);
    expect(memberPerms).toContain(PERMISSIONS.ANALYTICS_VIEW);
    expect(memberPerms).not.toContain(PERMISSIONS.ORG_MANAGE);
    expect(memberPerms).not.toContain(PERMISSIONS.ORG_MEMBERS_INVITE);
  });

  it('READ_ONLY can only read', () => {
    const readOnlyPerms = ROLE_PERMISSIONS['READ_ONLY'];
    expect(readOnlyPerms).toEqual([PERMISSIONS.ORG_READ]);
  });

  it('each role in hierarchy has a permissions entry', () => {
    for (const role of ROLE_HIERARCHY) {
      expect(ROLE_PERMISSIONS[role]).toBeDefined();
      expect(Array.isArray(ROLE_PERMISSIONS[role])).toBe(true);
    }
  });
});

describe('ROLES constants', () => {
  it('exports the four expected roles', () => {
    expect(ROLES.OWNER).toBe('OWNER');
    expect(ROLES.ADMIN).toBe('ADMIN');
    expect(ROLES.MEMBER).toBe('MEMBER');
    expect(ROLES.READ_ONLY).toBe('READ_ONLY');
  });
});
