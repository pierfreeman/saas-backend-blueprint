/**
 * auth.helper.ts — Generates test JWTs signed with the local test RSA private key.
 *
 * The matching public key is served by the nock-auth.ts interceptor as a JWKS
 * endpoint, so the full RS256 signature verification pipeline is exercised.
 *
 * Usage:
 *   const token = generateTestToken({ sub: 'auth0|owner-001', email: 'owner@test.com' });
 *   request.set('Authorization', `Bearer ${token}`);
 */
import * as jwt from 'jsonwebtoken';
import * as fs from 'fs';
import * as path from 'path';

const TEST_PRIVATE_KEY = fs.readFileSync(
  path.join(__dirname, '../keys/test-private.pem'),
  'utf8',
);

export const TEST_AUDIENCE = 'https://api.test.local';
export const TEST_ISSUER = 'https://test.auth0.local/';
export const TEST_KID = 'test-key-1';

export interface TestTokenOptions {
  /** Auth0 subject claim (auth0|...). Defaults to a generic test user. */
  sub?: string;
  /** Email claim. Defaults to a generated address based on sub. */
  email?: string;
  /** Token expiry. Defaults to '1h'. Pass -1 for an already-expired token. */
  expiresIn?: string | number;
}

/**
 * Generates a valid RS256 JWT accepted by the test NestJS application.
 */
export function generateTestToken(options: TestTokenOptions = {}): string {
  const sub = options.sub ?? 'auth0|test-user-default';
  return jwt.sign(
    {
      sub,
      email: options.email ?? `${sub.replace('auth0|', '')}@test.local`,
      iss: TEST_ISSUER,
      aud: TEST_AUDIENCE,
    },
    TEST_PRIVATE_KEY,
    {
      algorithm: 'RS256',
      expiresIn: options.expiresIn !== undefined ? (options.expiresIn as string | number) : '1h',
      keyid: TEST_KID,
    } as jwt.SignOptions,
  );
}

/**
 * Generates an already-expired JWT for testing 401 responses.
 */
export function generateExpiredToken(sub = 'auth0|test-expired'): string {
  return generateTestToken({ sub, expiresIn: -10 });
}
