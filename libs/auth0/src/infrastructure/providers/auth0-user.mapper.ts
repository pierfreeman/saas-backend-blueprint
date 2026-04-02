import type { IdentityUser } from '@libs/common';

/**
 * Maps an Auth0 Management API user response to the provider-agnostic
 * IdentityUser domain type.
 */
export function toIdentityUser(raw: {
  user_id: string;
  email: string;
  email_verified: boolean;
  given_name?: string;
  family_name?: string;
  name?: string;
  picture?: string;
  identities: Array<{ connection: string; provider: string }>;
}): IdentityUser {
  return {
    externalId: raw.user_id,
    email: raw.email,
    emailVerified: raw.email_verified,
    firstName: raw.given_name,
    lastName: raw.family_name,
    displayName: raw.name,
    pictureUrl: raw.picture,
    connections: raw.identities.map((i) => ({
      connection: i.connection,
      provider: i.provider,
    })),
  };
}
