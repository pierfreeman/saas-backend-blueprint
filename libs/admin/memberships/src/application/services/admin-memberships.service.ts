import { Injectable } from '@nestjs/common';
import {
  Membership,
  MembershipRole,
  MembershipStatus,
  User,
} from '@libs/prisma-business';
import {
  MembershipsService,
  InviteMemberService,
  RemoveMemberService,
  type InviteMemberResult,
} from '@libs/memberships';
import { AdminMembershipsRepository } from '../../infrastructure/repositories/admin-memberships.repository';
import type {
  AdminMemberItem,
  ChangeRoleInput,
  InviteMemberInput,
  ListMembersPagination,
  PaginatedAdminMembersResult,
  RemoveMemberInput,
} from '../../dto/admin-memberships.dto';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

@Injectable()
export class AdminMembershipsService {
  constructor(
    private readonly repository: AdminMembershipsRepository,
    private readonly membershipsService: MembershipsService,
    private readonly inviteMemberService: InviteMemberService,
    private readonly removeMemberService: RemoveMemberService,
  ) {}

  /**
   * Returns a paginated list of all memberships for an organization,
   * including user profile data.
   */
  async listMembers(
    orgId: string,
    pagination: Partial<ListMembersPagination> = {},
    filters: { status?: MembershipStatus } = {},
  ): Promise<PaginatedAdminMembersResult> {
    const limit = Math.min(pagination.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
    const offset = pagination.offset ?? 0;

    const { items, total } = await this.repository.findByOrgPaginated(
      orgId,
      { limit, offset },
      filters,
    );

    return {
      items: items.map((m) => this.toMemberItem(m)),
      total,
      limit,
      offset,
    };
  }

  /**
   * Changes a member's role within an organization.
   * Delegates to MembershipsService (preserves dual audit).
   */
  async changeRole(input: ChangeRoleInput): Promise<Membership> {
    return this.membershipsService.updateMembership(
      input.membershipId,
      input.orgId,
      { role: input.newRole },
      input.actorAdminId,
    );
  }

  /**
   * Sends an invitation email and creates the membership.
   * Delegates to InviteMemberService (preserves full invite flow).
   */
  async inviteMember(input: InviteMemberInput): Promise<InviteMemberResult> {
    return this.inviteMemberService.invite(
      input.email,
      input.role,
      input.orgId,
      input.actorAdminId,
    );
  }

  /**
   * Removes a member from an organization, including full account cleanup
   * when the user has no remaining memberships.
   * Delegates to RemoveMemberService (preserves cleanup logic).
   */
  async removeMember(input: RemoveMemberInput): Promise<void> {
    return this.removeMemberService.remove(
      input.membershipId,
      input.orgId,
      input.actorAdminId,
    );
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  private toMemberItem(m: Membership & { user: User }): AdminMemberItem {
    return {
      id: m.id,
      orgId: m.orgId,
      userId: m.userId,
      role: m.role as MembershipRole,
      status: m.status as MembershipStatus,
      createdAt: m.createdAt,
      user: {
        id: m.user.id,
        email: m.user.email,
        firstName: m.user.firstName ?? null,
        lastName: m.user.lastName ?? null,
        pictureUrl: m.user.pictureUrl ?? null,
      },
    };
  }
}
