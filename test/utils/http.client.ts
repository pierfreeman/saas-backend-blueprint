/**
 * http.client.ts — Supertest helper factories for integration tests.
 *
 * Provides convenience wrappers that:
 *  - Attach the Authorization header with a test JWT
 *  - Attach the x-org-id header for org-scoped requests
 *
 * Usage:
 *   const token = generateTestToken({ sub: ctx.owner.auth0Id });
 *   const res = await authGet(request, '/organizations', token);
 *   const res = await orgGet(request, `/organizations/${orgId}`, token, orgId);
 */
import * as supertest from 'supertest';

type SupertestAgent = ReturnType<typeof supertest.agent>;
type TestRequest = supertest.Test;

// ─── Authenticated request helpers ───────────────────────────────────────────

export function authGet(
  agent: SupertestAgent,
  url: string,
  token: string,
): TestRequest {
  return agent.get(url).set('Authorization', `Bearer ${token}`);
}

export function authPost(
  agent: SupertestAgent,
  url: string,
  token: string,
  body?: object,
): TestRequest {
  return agent
    .post(url)
    .set('Authorization', `Bearer ${token}`)
    .send(body ?? {});
}

export function authPatch(
  agent: SupertestAgent,
  url: string,
  token: string,
  body?: object,
): TestRequest {
  return agent
    .patch(url)
    .set('Authorization', `Bearer ${token}`)
    .send(body ?? {});
}

export function authDelete(
  agent: SupertestAgent,
  url: string,
  token: string,
): TestRequest {
  return agent.delete(url).set('Authorization', `Bearer ${token}`);
}

// ─── Org-scoped request helpers (adds x-org-id header) ───────────────────────

export function orgGet(
  agent: SupertestAgent,
  url: string,
  token: string,
  orgId: string,
): TestRequest {
  return agent
    .get(url)
    .set('Authorization', `Bearer ${token}`)
    .set('x-org-id', orgId);
}

export function orgPost(
  agent: SupertestAgent,
  url: string,
  token: string,
  orgId: string,
  body?: object,
): TestRequest {
  return agent
    .post(url)
    .set('Authorization', `Bearer ${token}`)
    .set('x-org-id', orgId)
    .send(body ?? {});
}

export function orgPatch(
  agent: SupertestAgent,
  url: string,
  token: string,
  orgId: string,
  body?: object,
): TestRequest {
  return agent
    .patch(url)
    .set('Authorization', `Bearer ${token}`)
    .set('x-org-id', orgId)
    .send(body ?? {});
}

export function orgDelete(
  agent: SupertestAgent,
  url: string,
  token: string,
  orgId: string,
): TestRequest {
  return agent
    .delete(url)
    .set('Authorization', `Bearer ${token}`)
    .set('x-org-id', orgId);
}
