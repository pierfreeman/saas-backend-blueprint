import { registerAs } from '@nestjs/config';

/**
 * Admin Auth0 configuration.
 *
 * Uses a separate Auth0 application ("SaaS Admin Portal") and a dedicated
 * user database connection ("Admin-Users-DB") that is isolated from the
 * tenant user pool.  Signup is disabled on the Admin-Users-DB connection —
 * admin accounts are created exclusively via the manage-admin-user.mjs script.
 *
 * Required environment variables:
 *   ADMIN_AUTH0_DOMAIN           — Auth0 tenant domain (same tenant, different app)
 *   ADMIN_AUTH0_AUDIENCE         — API identifier for the Admin API resource server
 *   ADMIN_AUTH0_CLAIMS_NAMESPACE — namespace prefix for custom claims in the JWT
 *
 * Optional:
 *   ADMIN_AUTH0_M2M_CLIENT_ID     — M2M client for user management (scripts only)
 *   ADMIN_AUTH0_M2M_CLIENT_SECRET — M2M client secret (scripts only)
 */
export default registerAs('adminAuth', () => ({
  domain: process.env['ADMIN_AUTH0_DOMAIN'] ?? '',
  audience: process.env['ADMIN_AUTH0_AUDIENCE'] ?? '',
  issuer: `https://${process.env['ADMIN_AUTH0_DOMAIN']}/`,
  jwksUri: `https://${process.env['ADMIN_AUTH0_DOMAIN']}/.well-known/jwks.json`,
  claimsNamespace:
    process.env['ADMIN_AUTH0_CLAIMS_NAMESPACE'] ??
    'https://admin.saas-api.com/',
  m2mClientId: process.env['ADMIN_AUTH0_M2M_CLIENT_ID'] ?? '',
  m2mClientSecret: process.env['ADMIN_AUTH0_M2M_CLIENT_SECRET'] ?? '',
}));

export type AdminAuthConfig = {
  domain: string;
  audience: string;
  issuer: string;
  jwksUri: string;
  claimsNamespace: string;
  m2mClientId: string;
  m2mClientSecret: string;
};
