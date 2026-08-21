/**
 * planning.integration.spec.ts
 *
 * Integration tests for the planning events REST API:
 *   POST   /organizations/:orgId/planning/events               (create)
 *   GET    /organizations/:orgId/planning/events?from=&to=      (list / range query)
 *   GET    /organizations/:orgId/planning/events/:id            (get detail)
 *   PATCH  /organizations/:orgId/planning/events/:id            (update)
 *   DELETE /organizations/:orgId/planning/events/:id            (delete)
 *   POST   /organizations/:orgId/planning/events/:id/rsvp       (rsvp)
 *   POST   /organizations/:orgId/planning/events/:id/exceptions (create exception)
 *   GET    /organizations/:orgId/planning/events/conflicts      (user overlap query)
 *
 * Verifies:
 *   - Authentication guard rejects unauthenticated and expired-token requests.
 *   - Validation pipe rejects invalid DTOs (missing fields, bad dates, range limits).
 *   - RBAC: READ_ONLY members cannot use PLANNING_MANAGE endpoints (create, update, delete, exceptions).
 *   - RBAC: READ_ONLY members can use ORG_READ endpoints (list, get detail, rsvp).
 *   - Full CRUD lifecycle: create → list → get detail → update → delete.
 *   - Recurring events: RRULE expansion returns the correct number of occurrences.
 *   - Exceptions: cancelled occurrences are excluded from list results.
 *   - Optimistic locking: updating with a stale version returns 409.
 *   - RSVP: upsert behaviour and 404 for non-existent event.
 *   - Role-based modification: MEMBER can only modify events they created.
 *   - Multi-tenancy: events from org A are not visible from org B.
 *   - 404 for operations on non-existent event UUIDs.
 */
import { INestApplication } from '@nestjs/common';
import * as supertest from 'supertest';
import { bootstrapTestApp } from '../support/app-bootstrap';
import { setupNockAuth, teardownNockAuth } from '@test/support/nock-auth';
import {
  generateTestToken,
  generateExpiredToken,
} from '@test/utils/auth.helper';
import { resetBusinessDb } from '@test/utils/db-reset.helper';
import { seedFullOrg } from '@test/utils/seed.helper';
import { PrismaBusinessService } from '@libs/prisma-business';
import { getTestAdminPrisma } from '@test/utils/admin-db.helper';

/** Base route for planning events scoped to an organisation. */
const BASE = (orgId: string) => `/organizations/${orgId}/planning/events`;

describe('Planning Events (integration)', () => {
  let app: INestApplication;
  let agent: ReturnType<typeof supertest.agent>;
  let prisma: PrismaBusinessService;

  beforeAll(async () => {
    setupNockAuth();
    app = await bootstrapTestApp();
    agent = supertest.agent(app.getHttpServer());
    prisma = await getTestAdminPrisma();
    await resetBusinessDb(prisma);
  });

  afterAll(async () => {
    await app.close();
    teardownNockAuth();
  });

  // ── Authentication ─────────────────────────────────────────────────────────

  describe('Authentication', () => {
    const fakeOrgId = '00000000-0000-0000-0000-000000000001';
    const fakeEventId = '00000000-0000-0000-0000-000000000002';

    it('POST /events returns 401 without a token', async () => {
      const res = await agent.post(BASE(fakeOrgId)).send({});
      expect(res.status).toBe(401);
    });

    it('GET /events returns 401 without a token', async () => {
      const res = await agent.get(BASE(fakeOrgId));
      expect(res.status).toBe(401);
    });

    it('GET /events/:id returns 401 without a token', async () => {
      const res = await agent.get(`${BASE(fakeOrgId)}/${fakeEventId}`);
      expect(res.status).toBe(401);
    });

    it('PATCH /events/:id returns 401 without a token', async () => {
      const res = await agent
        .patch(`${BASE(fakeOrgId)}/${fakeEventId}`)
        .send({});
      expect(res.status).toBe(401);
    });

    it('DELETE /events/:id returns 401 without a token', async () => {
      const res = await agent.delete(`${BASE(fakeOrgId)}/${fakeEventId}`);
      expect(res.status).toBe(401);
    });

    it('POST /events/:id/rsvp returns 401 without a token', async () => {
      const res = await agent
        .post(`${BASE(fakeOrgId)}/${fakeEventId}/rsvp`)
        .send({});
      expect(res.status).toBe(401);
    });

    it('POST /events/:id/exceptions returns 401 without a token', async () => {
      const res = await agent
        .post(`${BASE(fakeOrgId)}/${fakeEventId}/exceptions`)
        .send({});
      expect(res.status).toBe(401);
    });

    it('GET /events/conflicts returns 401 without a token', async () => {
      const res = await agent.get(`${BASE(fakeOrgId)}/conflicts`).query({
        start: '2026-04-01T09:00:00Z',
        end: '2026-04-01T10:00:00Z',
      });
      expect(res.status).toBe(401);
    });

    it('returns 401 for an expired JWT', async () => {
      const expiredToken = generateExpiredToken();
      const res = await agent
        .get(BASE(fakeOrgId))
        .set('Authorization', `Bearer ${expiredToken}`);
      expect(res.status).toBe(401);
    });
  });

  // ── Validation (400) ───────────────────────────────────────────────────────

  describe('Validation (400)', () => {
    let orgId: string;
    let token: string;

    beforeAll(async () => {
      const ctx = await seedFullOrg(prisma, { plan: 'PRO' });
      orgId = ctx.org.id;
      token = generateTestToken({ sub: ctx.owner.auth0Id });
    });

    it('POST /events returns 400 when title is missing', async () => {
      const res = await agent
        .post(BASE(orgId))
        .set('Authorization', `Bearer ${token}`)
        .set('x-org-id', orgId)
        .send({
          start: '2026-04-01T09:00:00Z',
          end: '2026-04-01T10:00:00Z',
          eventTimezone: 'UTC',
        });
      expect(res.status).toBe(400);
    });

    it('POST /events returns 400 when start is missing', async () => {
      const res = await agent
        .post(BASE(orgId))
        .set('Authorization', `Bearer ${token}`)
        .set('x-org-id', orgId)
        .send({
          title: 'No start',
          end: '2026-04-01T10:00:00Z',
          eventTimezone: 'UTC',
        });
      expect(res.status).toBe(400);
    });

    it('POST /events returns 400 when end is missing', async () => {
      const res = await agent
        .post(BASE(orgId))
        .set('Authorization', `Bearer ${token}`)
        .set('x-org-id', orgId)
        .send({
          title: 'No end',
          start: '2026-04-01T09:00:00Z',
          eventTimezone: 'UTC',
        });
      expect(res.status).toBe(400);
    });

    it('POST /events returns 400 when start is not a valid ISO 8601 date', async () => {
      const res = await agent
        .post(BASE(orgId))
        .set('Authorization', `Bearer ${token}`)
        .set('x-org-id', orgId)
        .send({
          title: 'Bad start date',
          start: 'not-a-date',
          end: '2026-04-01T10:00:00Z',
          eventTimezone: 'UTC',
        });
      expect(res.status).toBe(400);
    });

    it('GET /events returns 400 when to <= from', async () => {
      const res = await agent
        .get(BASE(orgId))
        .set('Authorization', `Bearer ${token}`)
        .set('x-org-id', orgId)
        .query({
          from: '2026-04-30T00:00:00Z',
          to: '2026-04-01T00:00:00Z',
        });
      expect(res.status).toBe(400);
    });

    it('GET /events returns 400 when range exceeds 365 days', async () => {
      const res = await agent
        .get(BASE(orgId))
        .set('Authorization', `Bearer ${token}`)
        .set('x-org-id', orgId)
        .query({
          from: '2025-01-01T00:00:00Z',
          to: '2026-06-01T00:00:00Z',
        });
      expect(res.status).toBe(400);
    });

    it('GET /events/:id returns 400 for a non-UUID event id', async () => {
      const res = await agent
        .get(`${BASE(orgId)}/not-a-uuid`)
        .set('Authorization', `Bearer ${token}`)
        .set('x-org-id', orgId);
      expect(res.status).toBe(400);
    });

    it('PATCH /events/:id returns 400 for a non-UUID event id', async () => {
      const res = await agent
        .patch(`${BASE(orgId)}/not-a-uuid`)
        .set('Authorization', `Bearer ${token}`)
        .set('x-org-id', orgId)
        .send({ version: 1 });
      expect(res.status).toBe(400);
    });

    it('POST /events/:id/rsvp returns 400 when status is missing', async () => {
      const fakeEventId = '00000000-0000-0000-0000-000000000099';
      const res = await agent
        .post(`${BASE(orgId)}/${fakeEventId}/rsvp`)
        .set('Authorization', `Bearer ${token}`)
        .set('x-org-id', orgId)
        .send({});
      expect(res.status).toBe(400);
    });

    it('POST /events/:id/rsvp returns 400 for an invalid status value', async () => {
      const fakeEventId = '00000000-0000-0000-0000-000000000099';
      const res = await agent
        .post(`${BASE(orgId)}/${fakeEventId}/rsvp`)
        .set('Authorization', `Bearer ${token}`)
        .set('x-org-id', orgId)
        .send({ status: 'INVALID_STATUS' });
      expect(res.status).toBe(400);
    });

    it('POST /events/:id/exceptions returns 400 when originalStartUtc is missing', async () => {
      const fakeEventId = '00000000-0000-0000-0000-000000000099';
      const res = await agent
        .post(`${BASE(orgId)}/${fakeEventId}/exceptions`)
        .set('Authorization', `Bearer ${token}`)
        .set('x-org-id', orgId)
        .send({ isCancelled: true });
      expect(res.status).toBe(400);
    });

    it('GET /events/conflicts returns 400 when end <= start', async () => {
      const res = await agent
        .get(`${BASE(orgId)}/conflicts`)
        .set('Authorization', `Bearer ${token}`)
        .set('x-org-id', orgId)
        .query({
          start: '2026-04-01T10:00:00Z',
          end: '2026-04-01T09:00:00Z',
        });
      expect(res.status).toBe(400);
    });
  });

  // ── RBAC (403) ─────────────────────────────────────────────────────────────

  describe('RBAC (403)', () => {
    let orgId: string;
    let readOnlyToken: string;
    let createdEventId: string;

    beforeAll(async () => {
      const ctx = await seedFullOrg(prisma, {
        withReadOnly: true,
        plan: 'PRO',
      });
      orgId = ctx.org.id;
      const readOnly = ctx.readOnly;
      if (!readOnly) throw new Error('Expected readOnly member in test org');
      readOnlyToken = generateTestToken({ sub: readOnly.auth0Id });

      // Owner creates an event to be used in permission-check tests.
      const ownerToken = generateTestToken({ sub: ctx.owner.auth0Id });
      const res = await agent
        .post(BASE(orgId))
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('x-org-id', orgId)
        .send({
          title: 'RBAC Test Event',
          start: '2026-04-01T09:00:00Z',
          end: '2026-04-01T10:00:00Z',
          eventTimezone: 'UTC',
        });
      createdEventId = res.body.id as string;
    });

    it('READ_ONLY cannot create an event (PLANNING_MANAGE required)', async () => {
      const res = await agent
        .post(BASE(orgId))
        .set('Authorization', `Bearer ${readOnlyToken}`)
        .set('x-org-id', orgId)
        .send({
          title: 'Forbidden Create',
          start: '2026-04-01T09:00:00Z',
          end: '2026-04-01T10:00:00Z',
          eventTimezone: 'UTC',
        });
      expect(res.status).toBe(403);
    });

    it('READ_ONLY cannot update an event (PLANNING_MANAGE required)', async () => {
      const res = await agent
        .patch(`${BASE(orgId)}/${createdEventId}`)
        .set('Authorization', `Bearer ${readOnlyToken}`)
        .set('x-org-id', orgId)
        .send({ version: 1, title: 'Tried to change' });
      expect(res.status).toBe(403);
    });

    it('READ_ONLY cannot delete an event (PLANNING_MANAGE required)', async () => {
      const res = await agent
        .delete(`${BASE(orgId)}/${createdEventId}`)
        .set('Authorization', `Bearer ${readOnlyToken}`)
        .set('x-org-id', orgId);
      expect(res.status).toBe(403);
    });

    it('READ_ONLY cannot create an exception (PLANNING_MANAGE required)', async () => {
      const res = await agent
        .post(`${BASE(orgId)}/${createdEventId}/exceptions`)
        .set('Authorization', `Bearer ${readOnlyToken}`)
        .set('x-org-id', orgId)
        .send({ originalStartUtc: '2026-04-01T09:00:00Z', isCancelled: true });
      expect(res.status).toBe(403);
    });

    it('READ_ONLY can list events (ORG_READ permission)', async () => {
      const res = await agent
        .get(BASE(orgId))
        .set('Authorization', `Bearer ${readOnlyToken}`)
        .set('x-org-id', orgId)
        .query({ from: '2026-01-01T00:00:00Z', to: '2026-12-31T23:59:59Z' });
      expect(res.status).toBe(200);
    });

    it('READ_ONLY can get event detail (ORG_READ permission)', async () => {
      const res = await agent
        .get(`${BASE(orgId)}/${createdEventId}`)
        .set('Authorization', `Bearer ${readOnlyToken}`)
        .set('x-org-id', orgId);
      expect(res.status).toBe(200);
    });

    it('READ_ONLY can RSVP to an event (ORG_READ permission)', async () => {
      const res = await agent
        .post(`${BASE(orgId)}/${createdEventId}/rsvp`)
        .set('Authorization', `Bearer ${readOnlyToken}`)
        .set('x-org-id', orgId)
        .send({ status: 'YES' });
      expect(res.status).toBe(201);
    });

    it('READ_ONLY can query conflicts (ORG_READ permission)', async () => {
      const res = await agent
        .get(`${BASE(orgId)}/conflicts`)
        .set('Authorization', `Bearer ${readOnlyToken}`)
        .set('x-org-id', orgId)
        .query({
          start: '2026-04-01T08:00:00Z',
          end: '2026-04-01T12:00:00Z',
        });
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });
  });

  // ── Conflicts ─────────────────────────────────────────────────────────────

  describe('Conflicts', () => {
    it('returns overlapping occurrences where current user is creator or attendee', async () => {
      const ctx = await seedFullOrg(prisma, { withMember: true, plan: 'PRO' });
      if (!ctx.member) throw new Error('Expected member in seeded org');
      const orgId = ctx.org.id;
      const ownerToken = generateTestToken({ sub: ctx.owner.auth0Id });
      const memberToken = generateTestToken({ sub: ctx.member.auth0Id });

      // Event A: member is attendee and overlaps [09:30, 09:45)
      const eventA = await agent
        .post(BASE(orgId))
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('x-org-id', orgId)
        .send({
          title: 'Conflict A',
          start: '2026-05-01T09:00:00Z',
          end: '2026-05-01T10:00:00Z',
          eventTimezone: 'UTC',
          attendeeIds: [ctx.member.user.id],
        });
      expect(eventA.status).toBe(201);

      // Event B: member is attendee but does NOT overlap [09:30, 09:45)
      const eventB = await agent
        .post(BASE(orgId))
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('x-org-id', orgId)
        .send({
          title: 'No Conflict B',
          start: '2026-05-01T10:00:00Z',
          end: '2026-05-01T10:30:00Z',
          eventTimezone: 'UTC',
          attendeeIds: [ctx.member.user.id],
        });
      expect(eventB.status).toBe(201);

      const res = await agent
        .get(`${BASE(orgId)}/conflicts`)
        .set('Authorization', `Bearer ${memberToken}`)
        .set('x-org-id', orgId)
        .query({
          start: '2026-05-01T09:30:00Z',
          end: '2026-05-01T09:45:00Z',
        });

      expect(res.status).toBe(200);
      const eventIds = (res.body as Array<{ eventId: string }>).map(
        (o) => o.eventId,
      );
      expect(eventIds).toContain(eventA.body.id as string);
      expect(eventIds).not.toContain(eventB.body.id as string);
    });
  });

  // ── Event lifecycle ────────────────────────────────────────────────────────

  describe('Event lifecycle', () => {
    it('create → list → get detail → update → delete', async () => {
      const ctx = await seedFullOrg(prisma);
      const ownerToken = generateTestToken({ sub: ctx.owner.auth0Id });
      const orgId = ctx.org.id;

      // ── POST /events — create ──────────────────────────────────────────────

      const createRes = await agent
        .post(BASE(orgId))
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('x-org-id', orgId)
        .send({
          title: 'Sprint Planning',
          description: 'Quarterly sprint kickoff',
          location: 'Conference Room A',
          start: '2026-04-01T09:00:00Z',
          end: '2026-04-01T10:00:00Z',
          eventTimezone: 'Europe/Rome',
        });

      expect(createRes.status).toBe(201);
      expect(createRes.body).toMatchObject({
        orgId,
        title: 'Sprint Planning',
        description: 'Quarterly sprint kickoff',
        location: 'Conference Room A',
      });
      expect(createRes.body.id).toBeTruthy();

      // Creator is automatically added as an attendee with RSVPStatus.YES.
      const attendees = createRes.body.attendees as Array<{ status: string }>;
      expect(attendees.some((a) => a.status === 'YES')).toBe(true);

      const eventId = createRes.body.id as string;

      // ── GET /events — list in range ────────────────────────────────────────

      const listRes = await agent
        .get(BASE(orgId))
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('x-org-id', orgId)
        .query({
          from: '2026-04-01T00:00:00Z',
          to: '2026-04-01T23:59:59Z',
        });

      expect(listRes.status).toBe(200);
      expect(Array.isArray(listRes.body)).toBe(true);
      expect(
        (listRes.body as Array<{ eventId: string }>).some(
          (occ) => occ.eventId === eventId,
        ),
      ).toBe(true);

      // ── GET /events/:id — get detail ───────────────────────────────────────

      const detailRes = await agent
        .get(`${BASE(orgId)}/${eventId}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('x-org-id', orgId);

      expect(detailRes.status).toBe(200);
      expect(detailRes.body.id).toBe(eventId);
      expect(Array.isArray(detailRes.body.attendees)).toBe(true);
      expect(Array.isArray(detailRes.body.exceptions)).toBe(true);

      // ── PATCH /events/:id — update ─────────────────────────────────────────

      const updateRes = await agent
        .patch(`${BASE(orgId)}/${eventId}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('x-org-id', orgId)
        .send({ version: 1, title: 'Sprint Planning (updated)' });

      expect(updateRes.status).toBe(200);
      expect(updateRes.body.title).toBe('Sprint Planning (updated)');
      expect(updateRes.body.version).toBe(2);

      // ── DELETE /events/:id ─────────────────────────────────────────────────

      const deleteRes = await agent
        .delete(`${BASE(orgId)}/${eventId}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('x-org-id', orgId);

      expect(deleteRes.status).toBe(200);
      expect(deleteRes.body).toMatchObject({
        message: 'Event deleted successfully',
      });

      // ── Verify deletion — event absent from list ────────────────────────────

      const listAfterDelete = await agent
        .get(BASE(orgId))
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('x-org-id', orgId)
        .query({
          from: '2026-04-01T00:00:00Z',
          to: '2026-04-01T23:59:59Z',
        });

      expect(
        (listAfterDelete.body as Array<{ eventId: string }>).some(
          (occ) => occ.eventId === eventId,
        ),
      ).toBe(false);

      // ── Verify deletion — get detail returns 404 ───────────────────────────

      const detailAfterDelete = await agent
        .get(`${BASE(orgId)}/${eventId}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('x-org-id', orgId);

      expect(detailAfterDelete.status).toBe(404);
    });
  });

  // ── Recurrence & Exceptions ────────────────────────────────────────────────

  describe('Recurrence & Exceptions', () => {
    it('expanding a FREQ=DAILY;COUNT=3 event returns 3 sorted occurrences', async () => {
      const ctx = await seedFullOrg(prisma);
      const token = generateTestToken({ sub: ctx.owner.auth0Id });
      const orgId = ctx.org.id;

      // Create a daily event that repeats 3 times starting 10 Apr 2026.
      const createRes = await agent
        .post(BASE(orgId))
        .set('Authorization', `Bearer ${token}`)
        .set('x-org-id', orgId)
        .send({
          title: 'Daily Standup',
          start: '2026-04-10T09:00:00Z',
          end: '2026-04-10T09:15:00Z',
          eventTimezone: 'UTC',
          rrule: 'FREQ=DAILY;COUNT=3',
        });

      expect(createRes.status).toBe(201);
      const eventId = createRes.body.id as string;

      // List over 7 days — expect exactly 3 occurrences (Apr 10, 11, 12).
      const listRes = await agent
        .get(BASE(orgId))
        .set('Authorization', `Bearer ${token}`)
        .set('x-org-id', orgId)
        .query({
          from: '2026-04-10T00:00:00Z',
          to: '2026-04-16T23:59:59Z',
        });

      expect(listRes.status).toBe(200);

      const occurrences = (
        listRes.body as Array<{ eventId: string; startUtc: string }>
      ).filter((occ) => occ.eventId === eventId);

      expect(occurrences).toHaveLength(3);

      // Verify chronological order.
      const starts = occurrences.map((occ) => new Date(occ.startUtc).getTime());
      for (let i = 1; i < starts.length; i++) {
        expect(starts[i - 1]).toBeLessThan(starts[i]);
      }
    });

    it('a cancelled exception is excluded from list results', async () => {
      const ctx = await seedFullOrg(prisma);
      const token = generateTestToken({ sub: ctx.owner.auth0Id });
      const orgId = ctx.org.id;

      // Create a daily recurring event with 3 occurrences starting 20 Apr.
      const createRes = await agent
        .post(BASE(orgId))
        .set('Authorization', `Bearer ${token}`)
        .set('x-org-id', orgId)
        .send({
          title: 'Weekly Review',
          start: '2026-04-20T10:00:00Z',
          end: '2026-04-20T11:00:00Z',
          eventTimezone: 'UTC',
          rrule: 'FREQ=DAILY;COUNT=3',
        });

      const eventId = createRes.body.id as string;

      // Cancel the 2nd occurrence (Apr 21).
      const exceptionRes = await agent
        .post(`${BASE(orgId)}/${eventId}/exceptions`)
        .set('Authorization', `Bearer ${token}`)
        .set('x-org-id', orgId)
        .send({
          originalStartUtc: '2026-04-21T10:00:00Z',
          isCancelled: true,
        });

      expect(exceptionRes.status).toBe(201);

      // List should now return only Apr 20 and Apr 22.
      const listRes = await agent
        .get(BASE(orgId))
        .set('Authorization', `Bearer ${token}`)
        .set('x-org-id', orgId)
        .query({
          from: '2026-04-20T00:00:00Z',
          to: '2026-04-22T23:59:59Z',
        });

      const occurrences = (
        listRes.body as Array<{ eventId: string; startUtc: string }>
      ).filter((occ) => occ.eventId === eventId);

      expect(occurrences).toHaveLength(2);

      const startDates = occurrences.map((occ) =>
        new Date(occ.startUtc).toISOString().slice(0, 10),
      );
      expect(startDates).toContain('2026-04-20');
      expect(startDates).toContain('2026-04-22');
      expect(startDates).not.toContain('2026-04-21');
    });

    it('creating an exception on a non-recurring event returns 400', async () => {
      const ctx = await seedFullOrg(prisma);
      const token = generateTestToken({ sub: ctx.owner.auth0Id });
      const orgId = ctx.org.id;

      // Create a single (non-recurring) event.
      const createRes = await agent
        .post(BASE(orgId))
        .set('Authorization', `Bearer ${token}`)
        .set('x-org-id', orgId)
        .send({
          title: 'One-off Meeting',
          start: '2026-04-15T14:00:00Z',
          end: '2026-04-15T15:00:00Z',
          eventTimezone: 'UTC',
        });

      const eventId = createRes.body.id as string;

      const exceptionRes = await agent
        .post(`${BASE(orgId)}/${eventId}/exceptions`)
        .set('Authorization', `Bearer ${token}`)
        .set('x-org-id', orgId)
        .send({
          originalStartUtc: '2026-04-15T14:00:00Z',
          isCancelled: true,
        });

      expect(exceptionRes.status).toBe(400);
    });
  });

  // ── Optimistic locking (409) ───────────────────────────────────────────────

  describe('Optimistic locking (409)', () => {
    it('returns 409 when updating with a stale version number', async () => {
      const ctx = await seedFullOrg(prisma);
      const token = generateTestToken({ sub: ctx.owner.auth0Id });
      const orgId = ctx.org.id;

      const createRes = await agent
        .post(BASE(orgId))
        .set('Authorization', `Bearer ${token}`)
        .set('x-org-id', orgId)
        .send({
          title: 'Concurrent Event',
          start: '2026-05-01T09:00:00Z',
          end: '2026-05-01T10:00:00Z',
          eventTimezone: 'UTC',
        });

      const eventId = createRes.body.id as string;

      // First update succeeds — version advances from 1 to 2.
      const firstUpdate = await agent
        .patch(`${BASE(orgId)}/${eventId}`)
        .set('Authorization', `Bearer ${token}`)
        .set('x-org-id', orgId)
        .send({ version: 1, title: 'First update' });

      expect(firstUpdate.status).toBe(200);
      expect(firstUpdate.body.version).toBe(2);

      // Second update with stale version 1 — must return 409.
      const staleUpdate = await agent
        .patch(`${BASE(orgId)}/${eventId}`)
        .set('Authorization', `Bearer ${token}`)
        .set('x-org-id', orgId)
        .send({ version: 1, title: 'Stale update' });

      expect(staleUpdate.status).toBe(409);
    });
  });

  // ── RSVP ──────────────────────────────────────────────────────────────────

  describe('RSVP', () => {
    it('creates an RSVP record and allows updating the status', async () => {
      const ctx = await seedFullOrg(prisma, { withMember: true });
      const member = ctx.member;
      if (!member) throw new Error('Expected member in test org');
      const ownerToken = generateTestToken({ sub: ctx.owner.auth0Id });
      const memberToken = generateTestToken({ sub: member.auth0Id });
      const orgId = ctx.org.id;

      // Owner creates the event.
      const createRes = await agent
        .post(BASE(orgId))
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('x-org-id', orgId)
        .send({
          title: 'Team Lunch',
          start: '2026-05-10T12:00:00Z',
          end: '2026-05-10T13:00:00Z',
          eventTimezone: 'UTC',
        });

      const eventId = createRes.body.id as string;

      // Member RSVPs YES.
      const rsvpYes = await agent
        .post(`${BASE(orgId)}/${eventId}/rsvp`)
        .set('Authorization', `Bearer ${memberToken}`)
        .set('x-org-id', orgId)
        .send({ status: 'YES' });

      expect(rsvpYes.status).toBe(201);
      expect(rsvpYes.body.status).toBe('YES');

      // Member changes RSVP to NO (upsert — same endpoint, updated status).
      const rsvpNo = await agent
        .post(`${BASE(orgId)}/${eventId}/rsvp`)
        .set('Authorization', `Bearer ${memberToken}`)
        .set('x-org-id', orgId)
        .send({ status: 'NO' });

      expect(rsvpNo.status).toBe(201);
      expect(rsvpNo.body.status).toBe('NO');
    });

    it('returns 404 when RSVPing to a non-existent event', async () => {
      const ctx = await seedFullOrg(prisma);
      const token = generateTestToken({ sub: ctx.owner.auth0Id });
      const orgId = ctx.org.id;

      const res = await agent
        .post(`${BASE(orgId)}/00000000-0000-0000-0000-000000000099/rsvp`)
        .set('Authorization', `Bearer ${token}`)
        .set('x-org-id', orgId)
        .send({ status: 'YES' });

      expect(res.status).toBe(404);
    });
  });

  // ── Role-based modification ────────────────────────────────────────────────

  describe('Role-based modification', () => {
    it('MEMBER can update an event they created', async () => {
      const ctx = await seedFullOrg(prisma, { withMember: true });
      const member = ctx.member;
      if (!member) throw new Error('Expected member in test org');
      const memberToken = generateTestToken({ sub: member.auth0Id });
      const orgId = ctx.org.id;

      // Member creates their own event.
      const createRes = await agent
        .post(BASE(orgId))
        .set('Authorization', `Bearer ${memberToken}`)
        .set('x-org-id', orgId)
        .send({
          title: 'Member Event',
          start: '2026-06-01T09:00:00Z',
          end: '2026-06-01T10:00:00Z',
          eventTimezone: 'UTC',
        });

      expect(createRes.status).toBe(201);
      const eventId = createRes.body.id as string;

      const updateRes = await agent
        .patch(`${BASE(orgId)}/${eventId}`)
        .set('Authorization', `Bearer ${memberToken}`)
        .set('x-org-id', orgId)
        .send({ version: 1, title: 'Member Event (updated)' });

      expect(updateRes.status).toBe(200);
    });

    it('MEMBER cannot update an event created by another user', async () => {
      const ctx = await seedFullOrg(prisma, { withMember: true });
      const member = ctx.member;
      if (!member) throw new Error('Expected member in test org');
      const ownerToken = generateTestToken({ sub: ctx.owner.auth0Id });
      const memberToken = generateTestToken({ sub: member.auth0Id });
      const orgId = ctx.org.id;

      // Owner creates the event.
      const createRes = await agent
        .post(BASE(orgId))
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('x-org-id', orgId)
        .send({
          title: 'Owner Event',
          start: '2026-06-02T09:00:00Z',
          end: '2026-06-02T10:00:00Z',
          eventTimezone: 'UTC',
        });

      const eventId = createRes.body.id as string;

      // Member tries to update the owner's event — forbidden.
      const updateRes = await agent
        .patch(`${BASE(orgId)}/${eventId}`)
        .set('Authorization', `Bearer ${memberToken}`)
        .set('x-org-id', orgId)
        .send({ version: 1, title: 'Hijacked Title' });

      expect(updateRes.status).toBe(403);
    });

    it('ADMIN can update an event created by any member', async () => {
      const ctx = await seedFullOrg(prisma, {
        withAdmin: true,
        withMember: true,
      });
      const member = ctx.member;
      const admin = ctx.admin;
      if (!member || !admin)
        throw new Error('Expected member and admin in test org');
      const memberToken = generateTestToken({ sub: member.auth0Id });
      const adminToken = generateTestToken({ sub: admin.auth0Id });
      const orgId = ctx.org.id;

      // Member creates an event.
      const createRes = await agent
        .post(BASE(orgId))
        .set('Authorization', `Bearer ${memberToken}`)
        .set('x-org-id', orgId)
        .send({
          title: 'Member Created',
          start: '2026-06-03T09:00:00Z',
          end: '2026-06-03T10:00:00Z',
          eventTimezone: 'UTC',
        });

      const eventId = createRes.body.id as string;

      // Admin updates the member's event — allowed.
      const updateRes = await agent
        .patch(`${BASE(orgId)}/${eventId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('x-org-id', orgId)
        .send({ version: 1, title: 'Admin Approved Title' });

      expect(updateRes.status).toBe(200);
    });
  });

  // ── Multi-tenancy isolation ────────────────────────────────────────────────

  describe('Multi-tenancy isolation', () => {
    it('events from org A are not visible when listing from org B', async () => {
      const ctxA = await seedFullOrg(prisma);
      const ctxB = await seedFullOrg(prisma);
      const tokenA = generateTestToken({ sub: ctxA.owner.auth0Id });
      const tokenB = generateTestToken({ sub: ctxB.owner.auth0Id });

      // Create event in org A.
      const createRes = await agent
        .post(BASE(ctxA.org.id))
        .set('Authorization', `Bearer ${tokenA}`)
        .set('x-org-id', ctxA.org.id)
        .send({
          title: 'Org A Secret Meeting',
          start: '2026-07-01T09:00:00Z',
          end: '2026-07-01T10:00:00Z',
          eventTimezone: 'UTC',
        });

      const eventId = createRes.body.id as string;

      // List from org B — must not see org A's event.
      const listFromOrgB = await agent
        .get(BASE(ctxB.org.id))
        .set('Authorization', `Bearer ${tokenB}`)
        .set('x-org-id', ctxB.org.id)
        .query({
          from: '2026-07-01T00:00:00Z',
          to: '2026-07-01T23:59:59Z',
        });

      expect(listFromOrgB.status).toBe(200);
      expect(
        (listFromOrgB.body as Array<{ eventId: string }>).some(
          (occ) => occ.eventId === eventId,
        ),
      ).toBe(false);

      // Get detail from org B — must return 404.
      const detailFromOrgB = await agent
        .get(`${BASE(ctxB.org.id)}/${eventId}`)
        .set('Authorization', `Bearer ${tokenB}`)
        .set('x-org-id', ctxB.org.id);

      expect(detailFromOrgB.status).toBe(404);
    });

    it('a user cannot access org B routes without an active membership', async () => {
      const ctxA = await seedFullOrg(prisma);
      const ctxB = await seedFullOrg(prisma);
      const tokenA = generateTestToken({ sub: ctxA.owner.auth0Id });

      // Org A's owner attempts to list events in org B — must be rejected.
      const res = await agent
        .get(BASE(ctxB.org.id))
        .set('Authorization', `Bearer ${tokenA}`)
        .set('x-org-id', ctxB.org.id)
        .query({
          from: '2026-07-01T00:00:00Z',
          to: '2026-07-31T23:59:59Z',
        });

      expect(res.status).toBe(403);
    });
  });

  // ── 404 edge cases ─────────────────────────────────────────────────────────

  describe('404 edge cases', () => {
    const nonExistentId = '00000000-0000-0000-0000-eeeeeeeeeeee';

    let orgId: string;
    let token: string;

    beforeAll(async () => {
      const ctx = await seedFullOrg(prisma);
      orgId = ctx.org.id;
      token = generateTestToken({ sub: ctx.owner.auth0Id });
    });

    it('GET /events/:id returns 404 for a non-existent event', async () => {
      const res = await agent
        .get(`${BASE(orgId)}/${nonExistentId}`)
        .set('Authorization', `Bearer ${token}`)
        .set('x-org-id', orgId);
      expect(res.status).toBe(404);
    });

    it('PATCH /events/:id returns 404 for a non-existent event', async () => {
      const res = await agent
        .patch(`${BASE(orgId)}/${nonExistentId}`)
        .set('Authorization', `Bearer ${token}`)
        .set('x-org-id', orgId)
        .send({ version: 1, title: 'Ghost update' });
      expect(res.status).toBe(404);
    });

    it('DELETE /events/:id returns 404 for a non-existent event', async () => {
      const res = await agent
        .delete(`${BASE(orgId)}/${nonExistentId}`)
        .set('Authorization', `Bearer ${token}`)
        .set('x-org-id', orgId);
      expect(res.status).toBe(404);
    });

    it('POST /events/:id/exceptions returns 404 for a non-existent event', async () => {
      const res = await agent
        .post(`${BASE(orgId)}/${nonExistentId}/exceptions`)
        .set('Authorization', `Bearer ${token}`)
        .set('x-org-id', orgId)
        .send({ originalStartUtc: '2026-04-01T09:00:00Z' });
      expect(res.status).toBe(404);
    });

    it('POST /events/:id/split returns 404 for a non-existent event', async () => {
      const res = await agent
        .post(`${BASE(orgId)}/${nonExistentId}/split`)
        .set('Authorization', `Bearer ${token}`)
        .set('x-org-id', orgId)
        .send({ originalStartUtc: '2026-04-06T10:00:00Z', version: 1 });
      expect(res.status).toBe(404);
    });
  });

  // ── Split Series ("This and Following") ─────────────────────────────────────

  describe('POST /events/:id/split', () => {
    let orgId: string;
    let token: string;
    let adminToken: string;
    let memberToken: string;
    let readOnlyToken: string;

    beforeEach(async () => {
      await resetBusinessDb(prisma);
      const { org, owner, admin, member, readOnly } = await seedFullOrg(
        prisma,
        {
          withAdmin: true,
          withMember: true,
          withReadOnly: true,
        },
      );
      orgId = org.id;
      token = generateTestToken({ sub: owner.auth0Id, orgId: org.id });
      adminToken = generateTestToken({ sub: admin.auth0Id, orgId: org.id });
      memberToken = generateTestToken({ sub: member.auth0Id, orgId: org.id });
      readOnlyToken = generateTestToken({
        sub: readOnly.auth0Id,
        orgId: org.id,
      });
    });

    it('splits a FREQ=DAILY;COUNT=5 series at occurrence #3 (happy path)', async () => {
      // Create a recurring daily event with 5 occurrences starting on 2026-04-06.
      const createRes = await agent
        .post(BASE(orgId))
        .set('Authorization', `Bearer ${token}`)
        .set('x-org-id', orgId)
        .send({
          title: 'Daily Stand-up',
          start: '2026-04-06T09:00:00Z',
          end: '2026-04-06T09:30:00Z',
          eventTimezone: 'UTC',
          rrule: 'FREQ=DAILY;COUNT=5',
        });
      expect(createRes.status).toBe(201);
      const parentId = createRes.body.id as string;
      const parentVersion = createRes.body.version as number;

      // The 3rd occurrence is 2026-04-08T09:00:00Z.
      const splitPoint = '2026-04-08T09:00:00Z';

      const splitRes = await agent
        .post(`${BASE(orgId)}/${parentId}/split`)
        .set('Authorization', `Bearer ${token}`)
        .set('x-org-id', orgId)
        .send({
          originalStartUtc: splitPoint,
          version: parentVersion,
          title: 'Rescheduled Stand-up',
        });
      expect(splitRes.status).toBe(201);

      const newEventId = splitRes.body.id as string;
      expect(newEventId).not.toBe(parentId);
      expect(splitRes.body.title).toBe('Rescheduled Stand-up');
      expect(splitRes.body.rrule).toBeTruthy();

      // Original series should now only contain occurrences 1-2 (Apr 6 and 7).
      const originalRange = await agent
        .get(BASE(orgId))
        .set('Authorization', `Bearer ${token}`)
        .set('x-org-id', orgId)
        .query({ from: '2026-04-06T00:00:00Z', to: '2026-04-12T23:59:59Z' });
      expect(originalRange.status).toBe(200);

      const originalOccs = (originalRange.body as { eventId: string }[]).filter(
        (o) => o.eventId === parentId,
      );
      expect(originalOccs).toHaveLength(2); // Apr 6, Apr 7 only

      // Tail series should contain occurrences 3-5 (Apr 8, 9, 10).
      const tailOccs = (originalRange.body as { eventId: string }[]).filter(
        (o) => o.eventId === newEventId,
      );
      expect(tailOccs).toHaveLength(3); // Apr 8, 9, 10
    });

    it('returns 400 for a non-recurring event', async () => {
      const createRes = await agent
        .post(BASE(orgId))
        .set('Authorization', `Bearer ${token}`)
        .set('x-org-id', orgId)
        .send({
          title: 'Single Event',
          start: '2026-04-06T09:00:00Z',
          end: '2026-04-06T10:00:00Z',
          eventTimezone: 'UTC',
        });
      expect(createRes.status).toBe(201);

      const res = await agent
        .post(`${BASE(orgId)}/${createRes.body.id}/split`)
        .set('Authorization', `Bearer ${token}`)
        .set('x-org-id', orgId)
        .send({ originalStartUtc: '2026-04-06T09:00:00Z', version: 1 });
      expect(res.status).toBe(400);
    });

    it('returns 400 when originalStartUtc is not a valid occurrence', async () => {
      const createRes = await agent
        .post(BASE(orgId))
        .set('Authorization', `Bearer ${token}`)
        .set('x-org-id', orgId)
        .send({
          title: 'Daily Event',
          start: '2026-04-06T09:00:00Z',
          end: '2026-04-06T10:00:00Z',
          eventTimezone: 'UTC',
          rrule: 'FREQ=DAILY;COUNT=5',
        });
      expect(createRes.status).toBe(201);

      // A time that does not correspond to any RRULE-generated occurrence.
      const res = await agent
        .post(`${BASE(orgId)}/${createRes.body.id}/split`)
        .set('Authorization', `Bearer ${token}`)
        .set('x-org-id', orgId)
        .send({
          originalStartUtc: '2026-04-06T12:00:00Z', // wrong hour
          version: createRes.body.version,
        });
      expect(res.status).toBe(400);
    });

    it('returns 409 on version mismatch', async () => {
      const createRes = await agent
        .post(BASE(orgId))
        .set('Authorization', `Bearer ${token}`)
        .set('x-org-id', orgId)
        .send({
          title: 'Daily Event',
          start: '2026-04-06T09:00:00Z',
          end: '2026-04-06T10:00:00Z',
          eventTimezone: 'UTC',
          rrule: 'FREQ=DAILY;COUNT=5',
        });
      expect(createRes.status).toBe(201);

      const res = await agent
        .post(`${BASE(orgId)}/${createRes.body.id}/split`)
        .set('Authorization', `Bearer ${token}`)
        .set('x-org-id', orgId)
        .send({
          originalStartUtc: '2026-04-08T09:00:00Z',
          version: 99, // stale
        });
      expect(res.status).toBe(409);
    });

    it('returns 403 for READ_ONLY role', async () => {
      const createRes = await agent
        .post(BASE(orgId))
        .set('Authorization', `Bearer ${token}`)
        .set('x-org-id', orgId)
        .send({
          title: 'Daily Event',
          start: '2026-04-06T09:00:00Z',
          end: '2026-04-06T10:00:00Z',
          eventTimezone: 'UTC',
          rrule: 'FREQ=DAILY;COUNT=5',
        });
      expect(createRes.status).toBe(201);

      // readOnly token should be blocked by RBAC.
      const res = await agent
        .post(`${BASE(orgId)}/${createRes.body.id}/split`)
        .set('Authorization', `Bearer ${readOnlyToken}`)
        .set('x-org-id', orgId)
        .send({
          originalStartUtc: '2026-04-08T09:00:00Z',
          version: createRes.body.version,
        });
      expect(res.status).toBe(403);
    });

    it('returns 403 when a MEMBER splits an event they did not create', async () => {
      // Owner creates the event.
      const createRes = await agent
        .post(BASE(orgId))
        .set('Authorization', `Bearer ${token}`)
        .set('x-org-id', orgId)
        .send({
          title: 'Daily Event',
          start: '2026-04-06T09:00:00Z',
          end: '2026-04-06T10:00:00Z',
          eventTimezone: 'UTC',
          rrule: 'FREQ=DAILY;COUNT=5',
        });
      expect(createRes.status).toBe(201);

      // Member (different user) attempts to split it.
      const res = await agent
        .post(`${BASE(orgId)}/${createRes.body.id}/split`)
        .set('Authorization', `Bearer ${memberToken}`)
        .set('x-org-id', orgId)
        .send({
          originalStartUtc: '2026-04-08T09:00:00Z',
          version: createRes.body.version,
        });
      expect(res.status).toBe(403);
    });

    it('allows ADMIN to split an event they did not create', async () => {
      // Owner creates the event.
      const createRes = await agent
        .post(BASE(orgId))
        .set('Authorization', `Bearer ${token}`)
        .set('x-org-id', orgId)
        .send({
          title: 'Daily Event',
          start: '2026-04-06T09:00:00Z',
          end: '2026-04-06T10:00:00Z',
          eventTimezone: 'UTC',
          rrule: 'FREQ=DAILY;COUNT=5',
        });
      expect(createRes.status).toBe(201);

      const res = await agent
        .post(`${BASE(orgId)}/${createRes.body.id}/split`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('x-org-id', orgId)
        .send({
          originalStartUtc: '2026-04-08T09:00:00Z',
          version: createRes.body.version,
        });
      expect(res.status).toBe(201);
    });

    it('migrates exceptions at/after split point to the new event', async () => {
      const createRes = await agent
        .post(BASE(orgId))
        .set('Authorization', `Bearer ${token}`)
        .set('x-org-id', orgId)
        .send({
          title: 'Daily Event',
          start: '2026-04-06T09:00:00Z',
          end: '2026-04-06T10:00:00Z',
          eventTimezone: 'UTC',
          rrule: 'FREQ=DAILY;COUNT=5',
        });
      expect(createRes.status).toBe(201);
      const parentId = createRes.body.id as string;

      // Create an exception on occurrence #4 (2026-04-09).
      const excRes = await agent
        .post(`${BASE(orgId)}/${parentId}/exceptions`)
        .set('Authorization', `Bearer ${token}`)
        .set('x-org-id', orgId)
        .send({
          originalStartUtc: '2026-04-09T09:00:00Z',
          isCancelled: true,
        });
      expect(excRes.status).toBe(201);

      // Split at occurrence #3 (2026-04-08).
      const splitRes = await agent
        .post(`${BASE(orgId)}/${parentId}/split`)
        .set('Authorization', `Bearer ${token}`)
        .set('x-org-id', orgId)
        .send({
          originalStartUtc: '2026-04-08T09:00:00Z',
          version: createRes.body.version,
        });
      expect(splitRes.status).toBe(201);
      const newEventId = splitRes.body.id as string;

      // Fetch the new tail event detail — it should carry the migrated exception.
      const detailRes = await agent
        .get(`${BASE(orgId)}/${newEventId}`)
        .set('Authorization', `Bearer ${token}`)
        .set('x-org-id', orgId);
      expect(detailRes.status).toBe(200);
      expect(detailRes.body.exceptions).toHaveLength(1);
      expect(detailRes.body.exceptions[0].isCancelled).toBe(true);

      // Original event should have no exceptions left.
      const originalDetailRes = await agent
        .get(`${BASE(orgId)}/${parentId}`)
        .set('Authorization', `Bearer ${token}`)
        .set('x-org-id', orgId);
      expect(originalDetailRes.status).toBe(200);
      expect(originalDetailRes.body.exceptions).toHaveLength(0);
    });

    it('enforces multi-tenancy: cannot split an event from another org', async () => {
      // Seed a second org.
      const { org: org2, owner: owner2 } = await seedFullOrg(prisma);
      const token2 = generateTestToken({ sub: owner2.auth0Id, orgId: org2.id });

      // Create event in org1.
      const createRes = await agent
        .post(BASE(orgId))
        .set('Authorization', `Bearer ${token}`)
        .set('x-org-id', orgId)
        .send({
          title: 'Daily Event',
          start: '2026-04-06T09:00:00Z',
          end: '2026-04-06T10:00:00Z',
          eventTimezone: 'UTC',
          rrule: 'FREQ=DAILY;COUNT=5',
        });
      expect(createRes.status).toBe(201);

      // Try to split from org2 context.
      const res = await agent
        .post(`${BASE(org2.id)}/${createRes.body.id}/split`)
        .set('Authorization', `Bearer ${token2}`)
        .set('x-org-id', org2.id)
        .send({
          originalStartUtc: '2026-04-08T09:00:00Z',
          version: createRes.body.version,
        });
      expect(res.status).toBe(404);
    });
  });
});
