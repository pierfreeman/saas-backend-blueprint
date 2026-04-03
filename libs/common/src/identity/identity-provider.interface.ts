/**
 * Provider-agnostic identity user type.
 * Infrastructure providers map their raw SDK responses to this shape.
 */
export interface IdentityUser {
  externalId: string;
  email: string;
  emailVerified: boolean;
  firstName?: string;
  lastName?: string;
  displayName?: string;
  pictureUrl?: string;
  connections: Array<{ connection: string; provider: string }>;
}

/**
 * IIdentityProvider — port for external identity operations.
 *
 * Application services (`AuthService`, `InviteMemberService`,
 * `RemoveMemberService`) depend on this abstract class, not on the
 * concrete Auth0 implementation.
 *
 * To swap to a different provider (e.g. Clerk):
 *   1. Create `libs/clerk/` with `ClerkIdentityProvider extends IIdentityProvider`.
 *   2. Bind it in `Auth0Module` (or a new `ClerkModule`) — zero changes to
 *      any application service.
 *
 * Using an abstract class (rather than an interface) lets NestJS use it
 * directly as an injection token without a separate `Symbol`.
 */
export abstract class IIdentityProvider {
  /** Fetch a single identity user by their provider-issued ID (e.g. Auth0 `sub`). */
  abstract getUserById(externalId: string): Promise<IdentityUser>;

  /** Look up identity users by email address. Returns [] when none found. */
  abstract findUsersByEmail(email: string): Promise<IdentityUser[]>;

  /** Permanently delete the identity account for the given external ID. */
  abstract deleteUser(externalId: string): Promise<void>;

  /**
   * Send a passwordless magic-link invitation email.
   * Used for new members who have not yet created an account.
   */
  abstract sendInviteLink(email: string, redirectUri: string): Promise<void>;

  /** Send a password-reset / change-password email. */
  abstract sendChangePasswordEmail(email: string): Promise<void>;
}

/** Prefix used for auth0Id of users who were invited but haven't logged in yet. */
export const PENDING_USER_PREFIX = 'pending:';
