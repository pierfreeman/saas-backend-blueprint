/**
 * nock-auth.ts — Intercepts Auth0 JWKS HTTP requests during integration tests.
 *
 * The JwtStrategy uses `passportJwtSecret({ jwksUri: ... })` which calls the
 * Auth0 JWKS endpoint to fetch public keys for RS256 signature verification.
 *
 * This module replaces that HTTP call with a nock interceptor that returns a
 * JWKS payload built from the test RSA public key (`test/keys/test-public.pem`).
 *
 * Usage (in each test file's beforeAll):
 *   import { setupNockAuth, teardownNockAuth } from '@test/support/nock-auth';
 *
 *   beforeAll(() => setupNockAuth());
 *   afterAll(() => teardownNockAuth());
 */
import nock from 'nock';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const TEST_DOMAIN = 'test.auth0.local';
export const TEST_KID = 'test-key-1';
export const TEST_JWKS_URI = `https://${TEST_DOMAIN}/.well-known/jwks.json`;

function buildTestJwks(): object {
  const publicPem = fs.readFileSync(
    path.join(__dirname, '../keys/test-public.pem'),
    'utf8',
  );

  const keyObject = crypto.createPublicKey(publicPem);
  const jwk = keyObject.export({ format: 'jwk' }) as {
    n: string;
    e: string;
    kty: string;
  };

  return {
    keys: [
      {
        kty: jwk.kty,
        use: 'sig',
        n: jwk.n,
        e: jwk.e,
        kid: TEST_KID,
        alg: 'RS256',
      },
    ],
  };
}

/**
 * Installs a persistent nock interceptor for the Auth0 JWKS endpoint.
 * The interceptor responds with the test RSA public key in JWKS format.
 *
 * Call this BEFORE bootstrapping the NestJS app.
 */
export function setupNockAuth(): void {
  nock(`https://${TEST_DOMAIN}`)
    .get('/.well-known/jwks.json')
    .reply(200, buildTestJwks())
    .persist();
}

/**
 * Removes all nock interceptors. Call in afterAll.
 */
export function teardownNockAuth(): void {
  nock.cleanAll();
  nock.restore();
  if (!nock.isActive()) {
    nock.activate();
  }
}
