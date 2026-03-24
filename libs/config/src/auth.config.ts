import { registerAs } from '@nestjs/config';

export default registerAs('auth', () => ({
  domain: process.env['AUTH0_DOMAIN'],
  audience: process.env['AUTH0_AUDIENCE'],
  issuer: `https://${process.env['AUTH0_DOMAIN']}/`,
  jwksUri: `https://${process.env['AUTH0_DOMAIN']}/.well-known/jwks.json`,
  /** Auth0 Machine-to-Machine credentials for the Management API (optional — required only for email-based invite flow). */
  m2mClientId: process.env['AUTH0_M2M_CLIENT_ID'],
  m2mClientSecret: process.env['AUTH0_M2M_CLIENT_SECRET'],
}));
