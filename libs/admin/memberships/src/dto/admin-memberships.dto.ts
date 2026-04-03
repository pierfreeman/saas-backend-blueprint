import type { MembershipRole, MembershipStatus } from '@libs/prisma-business';

// ── Query ────────────────────────────────────────────────────────────────────

export interface ListMembersPagination {
  limit: number;
  offset: number;
}

// ── Response shapes ──────────────────────────────────────────────────────────

export interface AdminMemberItem {
  id: string;
  orgId: string;
  userId: string;
  role: MembershipRole;
  status: MembershipStatus;
  createdAt: Date;
  user: {
    id: string;
    email: string;
    firstName: string | null;
    lastName: string | null;
    pictureUrl: string | null;
  };
}

export interface PaginatedAdminMembersResult {
  items: AdminMemberItem[];
  total: number;
  limit: number;
  offset: number;
}

// ── Action inputs ────────────────────────────────────────────────────────────

export interface ChangeRoleInput {
  membershipId: string;
  orgId: string;
  newRole: MembershipRole;
  /** Internal DB ID of the admin performing the action. */
  actorAdminId: string;
}

export interface InviteMemberInput {
  orgId: string;
  email: string;
  role: MembershipRole;
  /** Internal DB ID of the admin performing the action. */
  actorAdminId: string;
}

export interface RemoveMemberInput {
  membershipId: string;
  orgId: string;
  /** Internal DB ID of the admin performing the action. */
  actorAdminId: string;
}
