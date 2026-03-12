import { registerAs } from '@nestjs/config';

export default registerAs('auth', () => ({
  domain: process.env['AUTH0_DOMAIN'],
  audience: process.env['AUTH0_AUDIENCE'],
  issuer: `https://${process.env['AUTH0_DOMAIN']}/`,
  jwksUri: `https://${process.env['AUTH0_DOMAIN']}/.well-known/jwks.json`,
}));
