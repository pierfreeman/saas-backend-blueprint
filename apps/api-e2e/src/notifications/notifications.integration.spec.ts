/**
 * notifications.integration.spec.ts
 *
 * Integration tests for the notifications REST API:
 *   GET    /notifications
 *   GET    /notifications/unread-count
 *   POST   /notifications
 *   PATCH  /notifications/:id/read
 *   PATCH  /notifications/read
 *   DELETE /notifications/:id
 *
 * Verifies:
 *   - Authentication guard rejects unauthenticated and expired-token requests.
 *   - CRUD lifecycle: create → list → mark-read → delete.
 *   - Unread counter increments on create and decrements on mark-read / delete.
 *   - markManyAsRead bulk-updates multiple records and adjusts the counter.
 *   - 404 for operations on non-existent or foreign notifications.
 *   - 400 for validation errors (missing fields, invalid UUIDs, bad params).
 *   - User isolation: each user sees only their own notifications.
 *   - Double mark-as-read returns 404 (already read).
 *   - Metadata is persisted and returned correctly.
 *   - Pagination (limit / offset) works correctly.
 */
import { INestApplication } from '@nestjs/common';
import * as supertest from 'supertest';
import { bootstrapTestApp } from '../support/app-bootstrap';
import { setupNockAuth, teardownNockAuth } from '../support/nock-auth';
import {
  generateTestToken,
  generateExpiredToken,
} from '@test/utils/auth.helper';
import { resetBusinessDb } from '@test/utils/db-reset.helper';
import { seedFullOrg } from '@test/utils/seed.helper';
import { PrismaBusinessService } from '@libs/prisma-business';
import { CacheService } from '@libs/redis';

describe('Notifications (integration)', () => {
  let app: INestApplication;
  let agent: ReturnType<typeof supertest.agent>;
  let prisma: PrismaBusinessService;
  let cache: CacheService;

  beforeAll(async () => {
    setupNockAuth();
    app = await bootstrapTestApp();
    agent = supertest.agent(app.getHttpServer());
    prisma = app.get(PrismaBusinessService);
    cache = app.get(CacheService);
    await resetBusinessDb(prisma);
  });

  afterAll(async () => {
    await app.close();
    teardownNockAuth();
  });

  // ── Authentication ─────────────────────────────────────────────────────────

  describe('Authentication', () => {
    it('GET /notifications returns 401 without a token', async () => {
      const res = await agent.get('/notifications');
      expect(res.status).toBe(401);
    });

    it('GET /notifications/unread-count returns 401 without a token', async () => {
      const res = await agent.get('/notifications/unread-count');
      expect(res.status).toBe(401);
    });

    it('POST /notifications returns 401 without a token', async () => {
      const res = await agent.post('/notifications').send({});
      expect(res.status).toBe(401);
    });

    it('PATCH /notifications/:id/read returns 401 without a token', async () => {
      const res = await agent.patch(
        '/notifications/00000000-0000-0000-0000-000000000001/read',
      );
      expect(res.status).toBe(401);
    });

    it('PATCH /notifications/read returns 401 without a token', async () => {
      const res = await agent.patch('/notifications/read').send({ ids: [] });
      expect(res.status).toBe(401);
    });

    it('DELETE /notifications/:id returns 401 without a token', async () => {
      const res = await agent.delete(
        '/notifications/00000000-0000-0000-0000-000000000001',
      );
      expect(res.status).toBe(401);
    });

    it('returns 401 for an expired JWT', async () => {
      const expiredToken = generateExpiredToken();
      const res = await agent
        .get('/notifications')
        .set('Authorization', `Bearer ${expiredToken}`);
      expect(res.status).toBe(401);
    });
  });

  // ── Validation ─────────────────────────────────────────────────────────────

  describe('Validation (400)', () => {
    let token: string;

    beforeAll(async () => {
      const ctx = await seedFullOrg(prisma);
      token = generateTestToken({ sub: ctx.owner.auth0Id });
    });

    it('POST /notifications returns 400 when required fields are missing', async () => {
      const res = await agent
        .post('/notifications')
        .set('Authorization', `Bearer ${token}`)
        .send({ type: 'alert' }); // missing orgId, userId, title, body
      expect(res.status).toBe(400);
    });

    it('POST /notifications returns 400 for invalid UUID in orgId', async () => {
      const res = await agent
        .post('/notifications')
        .set('Authorization', `Bearer ${token}`)
        .send({
          orgId: 'not-a-uuid',
          userId: '00000000-0000-0000-0000-000000000001',
          type: 'alert',
          title: 'T',
          body: 'B',
        });
      expect(res.status).toBe(400);
    });

    it('POST /notifications returns 400 for invalid UUID in userId', async () => {
      const res = await agent
        .post('/notifications')
        .set('Authorization', `Bearer ${token}`)
        .send({
          orgId: '00000000-0000-0000-0000-000000000001',
          userId: 'not-a-uuid',
          type: 'alert',
          title: 'T',
          body: 'B',
        });
      expect(res.status).toBe(400);
    });

    it('POST /notifications returns 400 when body is empty string', async () => {
      const res = await agent
        .post('/notifications')
        .set('Authorization', `Bearer ${token}`)
        .send({
          orgId: '00000000-0000-0000-0000-000000000001',
          userId: '00000000-0000-0000-0000-000000000002',
          type: 'alert',
          title: 'T',
          body: '',
        });
      expect(res.status).toBe(400);
    });

    it('PATCH /notifications/:id/read returns 400 for non-UUID id', async () => {
      const res = await agent
        .patch('/notifications/not-a-uuid/read')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(400);
    });

    it('DELETE /notifications/:id returns 400 for non-UUID id', async () => {
      const res = await agent
        .delete('/notifications/not-a-uuid')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(400);
    });

    it('PATCH /notifications/read returns 400 when ids contains non-UUIDs', async () => {
      const res = await agent
        .patch('/notifications/read')
        .set('Authorization', `Bearer ${token}`)
        .send({ ids: ['not-a-uuid'] });
      expect(res.status).toBe(400);
    });

    it('PATCH /notifications/read returns 400 when ids is missing', async () => {
      const res = await agent
        .patch('/notifications/read')
        .set('Authorization', `Bearer ${token}`)
        .send({});
      expect(res.status).toBe(400);
    });

    it('GET /notifications returns 400 when limit exceeds max (100)', async () => {
      const res = await agent
        .get('/notifications')
        .query({ limit: 999 })
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(400);
    });
  });

  // ── Full lifecycle ─────────────────────────────────────────────────────────

  describe('Notification lifecycle', () => {
    it('create → list → mark-read → delete', async () => {
      const ctx = await seedFullOrg(prisma);
      const ownerToken = generateTestToken({ sub: ctx.owner.auth0Id });
      const { id: userId } = ctx.owner.user;
      const { id: orgId } = ctx.org;

      // ── POST /notifications — create ───────────────────────────────────────

      const createRes = await agent
        .post('/notifications')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          orgId,
          userId,
          type: 'alert',
          title: 'Welcome',
          body: 'You have been invited to the organisation.',
        });

      expect(createRes.status).toBe(201);
      expect(createRes.body).toMatchObject({
        orgId,
        userId,
        type: 'alert',
        title: 'Welcome',
        readAt: null,
      });

      const notifId: string = createRes.body.id as string;

      // ── GET /notifications — list ──────────────────────────────────────────

      const listRes = await agent
        .get('/notifications')
        .query({ orgId })
        .set('Authorization', `Bearer ${ownerToken}`);

      expect(listRes.status).toBe(200);
      expect(Array.isArray(listRes.body)).toBe(true);
      expect(listRes.body.some((n: { id: string }) => n.id === notifId)).toBe(
        true,
      );

      // ── GET /notifications/unread-count — initial count ────────────────────

      const countRes = await agent
        .get('/notifications/unread-count')
        .set('Authorization', `Bearer ${ownerToken}`);

      expect(countRes.status).toBe(200);
      expect(countRes.body.count).toBeGreaterThanOrEqual(1);

      // ── PATCH /notifications/:id/read ──────────────────────────────────────

      const readRes = await agent
        .patch(`/notifications/${notifId}/read`)
        .set('Authorization', `Bearer ${ownerToken}`);

      expect(readRes.status).toBe(200);
      expect(readRes.body.readAt).not.toBeNull();

      // ── GET /notifications?unreadOnly=true — should be empty now ───────────

      const unreadRes = await agent
        .get('/notifications')
        .query({ orgId, unreadOnly: 'true' })
        .set('Authorization', `Bearer ${ownerToken}`);

      expect(unreadRes.status).toBe(200);
      const unreadIds = (unreadRes.body as Array<{ id: string }>).map(
        (n) => n.id,
      );
      expect(unreadIds).not.toContain(notifId);

      // ── DELETE /notifications/:id ──────────────────────────────────────────

      const deleteRes = await agent
        .delete(`/notifications/${notifId}`)
        .set('Authorization', `Bearer ${ownerToken}`);

      expect(deleteRes.status).toBe(204);

      // Verify it no longer appears in the list.
      const afterDeleteRes = await agent
        .get('/notifications')
        .query({ orgId })
        .set('Authorization', `Bearer ${ownerToken}`);

      const remaining = (afterDeleteRes.body as Array<{ id: string }>).map(
        (n) => n.id,
      );
      expect(remaining).not.toContain(notifId);
    });
  });

  // ── Metadata ───────────────────────────────────────────────────────────────

  describe('Metadata', () => {
    it('stores and returns arbitrary JSON metadata', async () => {
      const ctx = await seedFullOrg(prisma);
      const token = generateTestToken({ sub: ctx.owner.auth0Id });
      const { id: userId } = ctx.owner.user;
      const { id: orgId } = ctx.org;

      const metadata = { invoiceId: 'inv_abc', amount: 9900 };

      const res = await agent
        .post('/notifications')
        .set('Authorization', `Bearer ${token}`)
        .send({ orgId, userId, type: 'billing', title: 'Paid', body: 'Invoice paid', metadata });

      expect(res.status).toBe(201);
      expect(res.body.metadata).toEqual(metadata);
    });

    it('returns null metadata when not provided', async () => {
      const ctx = await seedFullOrg(prisma);
      const token = generateTestToken({ sub: ctx.owner.auth0Id });
      const { id: userId } = ctx.owner.user;
      const { id: orgId } = ctx.org;

      const res = await agent
        .post('/notifications')
        .set('Authorization', `Bearer ${token}`)
        .send({ orgId, userId, type: 'info', title: 'Hi', body: 'No metadata here' });

      expect(res.status).toBe(201);
      expect(res.body.metadata).toBeNull();
    });
  });

  // ── Unread counter ─────────────────────────────────────────────────────────

  describe('Unread counter', () => {
    it('increments on create and decrements on markAsRead', async () => {
      const ctx = await seedFullOrg(prisma);
      const token = generateTestToken({ sub: ctx.owner.auth0Id });
      const { id: userId } = ctx.owner.user;
      const { id: orgId } = ctx.org;

      // Flush any cached counter from prior tests.
      await cache.getClient().del(`notifications:unread:${userId}`);

      const baseline = await agent
        .get('/notifications/unread-count')
        .set('Authorization', `Bearer ${token}`);
      const before = baseline.body.count as number;

      // Create two notifications.
      const ids: string[] = [];
      for (const title of ['A', 'B']) {
        const r = await agent
          .post('/notifications')
          .set('Authorization', `Bearer ${token}`)
          .send({ orgId, userId, type: 'x', title, body: '.' });
        ids.push(r.body.id as string);
      }

      const afterCreate = await agent
        .get('/notifications/unread-count')
        .set('Authorization', `Bearer ${token}`);
      expect(afterCreate.body.count).toBe(before + 2);

      // Mark one as read.
      await agent
        .patch(`/notifications/${ids[0]}/read`)
        .set('Authorization', `Bearer ${token}`);

      const afterOne = await agent
        .get('/notifications/unread-count')
        .set('Authorization', `Bearer ${token}`);
      expect(afterOne.body.count).toBe(before + 1);
    });

    it('decrements correctly when deleting an unread notification', async () => {
      const ctx = await seedFullOrg(prisma);
      const token = generateTestToken({ sub: ctx.owner.auth0Id });
      const { id: userId } = ctx.owner.user;
      const { id: orgId } = ctx.org;

      await cache.getClient().del(`notifications:unread:${userId}`);

      const r = await agent
        .post('/notifications')
        .set('Authorization', `Bearer ${token}`)
        .send({ orgId, userId, type: 'x', title: 'Del me', body: '.' });

      const notifId = r.body.id as string;

      const before = (
        await agent
          .get('/notifications/unread-count')
          .set('Authorization', `Bearer ${token}`)
      ).body.count as number;

      await agent
        .delete(`/notifications/${notifId}`)
        .set('Authorization', `Bearer ${token}`);

      const after = (
        await agent
          .get('/notifications/unread-count')
          .set('Authorization', `Bearer ${token}`)
      ).body.count as number;

      expect(after).toBe(before - 1);
    });

    it('counter falls back to DB on cache miss', async () => {
      const ctx = await seedFullOrg(prisma);
      const token = generateTestToken({ sub: ctx.owner.auth0Id });
      const { id: userId } = ctx.owner.user;
      const { id: orgId } = ctx.org;

      // Create two unread notifications, then flush the cache key.
      for (const t of ['X', 'Y']) {
        await agent
          .post('/notifications')
          .set('Authorization', `Bearer ${token}`)
          .send({ orgId, userId, type: 'x', title: t, body: '.' });
      }

      await cache.getClient().del(`notifications:unread:${userId}`);

      const res = await agent
        .get('/notifications/unread-count')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.count).toBeGreaterThanOrEqual(2);
    });
  });

  // ── markManyAsRead ─────────────────────────────────────────────────────────

  describe('PATCH /notifications/read (bulk)', () => {
    it('marks multiple notifications as read in one request', async () => {
      const ctx = await seedFullOrg(prisma);
      const ownerToken = generateTestToken({ sub: ctx.owner.auth0Id });
      const { id: userId } = ctx.owner.user;
      const { id: orgId } = ctx.org;

      const ids: string[] = [];
      for (const title of ['Notif A', 'Notif B']) {
        const res = await agent
          .post('/notifications')
          .set('Authorization', `Bearer ${ownerToken}`)
          .send({ orgId, userId, type: 'info', title, body: 'Body' });

        ids.push(res.body.id as string);
      }

      const bulkRes = await agent
        .patch('/notifications/read')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ ids });

      expect(bulkRes.status).toBe(204);

      const all = await prisma.notification.findMany({
        where: { id: { in: ids } },
      });
      expect(all.every((n) => n.readAt !== null)).toBe(true);
    });

    it('silently skips IDs that belong to another user (no 404)', async () => {
      const ctx = await seedFullOrg(prisma, { withMember: true });
      const ownerToken = generateTestToken({ sub: ctx.owner.auth0Id });
      const memberToken = generateTestToken({ sub: ctx.member!.auth0Id });
      const { id: ownerId } = ctx.owner.user;
      const { id: memberId } = ctx.member!.user;
      const { id: orgId } = ctx.org;

      // Owner creates a notification for themselves.
      const ownerNotif = await agent
        .post('/notifications')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ orgId, userId: ownerId, type: 'x', title: 'Owner notif', body: '.' });

      // Member tries to bulk-mark the owner's notification — should be 204 but not update it.
      const bulkRes = await agent
        .patch('/notifications/read')
        .set('Authorization', `Bearer ${memberToken}`)
        .send({ ids: [ownerNotif.body.id as string] });

      expect(bulkRes.status).toBe(204);

      // Owner's notification is still unread.
      const notif = await prisma.notification.findUnique({
        where: { id: ownerNotif.body.id as string },
      });
      expect(notif?.readAt).toBeNull();

      // Member's own notification is unaffected.
      const memberNotif = await agent
        .post('/notifications')
        .set('Authorization', `Bearer ${memberToken}`)
        .send({ orgId, userId: memberId, type: 'x', title: 'Member notif', body: '.' });

      await agent
        .patch('/notifications/read')
        .set('Authorization', `Bearer ${memberToken}`)
        .send({ ids: [memberNotif.body.id as string] });

      const memberRecord = await prisma.notification.findUnique({
        where: { id: memberNotif.body.id as string },
      });
      expect(memberRecord?.readAt).not.toBeNull();
    });
  });

  // ── 404 edge cases ─────────────────────────────────────────────────────────

  describe('404 edge cases', () => {
    it('PATCH /:id/read returns 404 for a non-existent notification', async () => {
      const ctx = await seedFullOrg(prisma);
      const token = generateTestToken({ sub: ctx.owner.auth0Id });

      const res = await agent
        .patch('/notifications/00000000-0000-0000-0000-000000000099/read')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(404);
    });

    it('PATCH /:id/read returns 404 on a second call (already read)', async () => {
      const ctx = await seedFullOrg(prisma);
      const token = generateTestToken({ sub: ctx.owner.auth0Id });
      const { id: userId } = ctx.owner.user;
      const { id: orgId } = ctx.org;

      const create = await agent
        .post('/notifications')
        .set('Authorization', `Bearer ${token}`)
        .send({ orgId, userId, type: 'x', title: 'Once', body: '.' });

      const notifId = create.body.id as string;

      await agent
        .patch(`/notifications/${notifId}/read`)
        .set('Authorization', `Bearer ${token}`);

      // Second call — already read.
      const res = await agent
        .patch(`/notifications/${notifId}/read`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(404);
    });

    it('DELETE /:id returns 404 for a non-existent notification', async () => {
      const ctx = await seedFullOrg(prisma);
      const token = generateTestToken({ sub: ctx.owner.auth0Id });

      const res = await agent
        .delete('/notifications/00000000-0000-0000-0000-000000000099')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(404);
    });

    it('DELETE /:id returns 404 for a notification belonging to another user', async () => {
      const ctx = await seedFullOrg(prisma, { withMember: true });
      const ownerToken = generateTestToken({ sub: ctx.owner.auth0Id });
      const memberToken = generateTestToken({ sub: ctx.member!.auth0Id });

      const createRes = await agent
        .post('/notifications')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          orgId: ctx.org.id,
          userId: ctx.owner.user.id,
          type: 'alert',
          title: 'Private',
          body: 'Owner only',
        });

      const res = await agent
        .delete(`/notifications/${createRes.body.id as string}`)
        .set('Authorization', `Bearer ${memberToken}`);

      expect(res.status).toBe(404);
    });
  });

  // ── Cross-user isolation ───────────────────────────────────────────────────

  describe('Cross-user isolation', () => {
    it('returns 404 when marking a notification belonging to another user', async () => {
      const ctx = await seedFullOrg(prisma, { withMember: true });
      const ownerToken = generateTestToken({ sub: ctx.owner.auth0Id });
      const memberToken = generateTestToken({ sub: ctx.member!.auth0Id });

      const createRes = await agent
        .post('/notifications')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          orgId: ctx.org.id,
          userId: ctx.owner.user.id,
          type: 'alert',
          title: 'Private',
          body: 'Owner only',
        });

      const notifId: string = createRes.body.id as string;

      const res = await agent
        .patch(`/notifications/${notifId}/read`)
        .set('Authorization', `Bearer ${memberToken}`);

      expect(res.status).toBe(404);
    });

    it('GET /notifications returns only the authenticated users own notifications', async () => {
      const ctx = await seedFullOrg(prisma, { withMember: true });
      const ownerToken = generateTestToken({ sub: ctx.owner.auth0Id });
      const memberToken = generateTestToken({ sub: ctx.member!.auth0Id });
      const { id: orgId } = ctx.org;

      // Create one notification per user.
      const ownerNotif = await agent
        .post('/notifications')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ orgId, userId: ctx.owner.user.id, type: 'x', title: 'For owner', body: '.' });

      const memberNotif = await agent
        .post('/notifications')
        .set('Authorization', `Bearer ${memberToken}`)
        .send({ orgId, userId: ctx.member!.user.id, type: 'x', title: 'For member', body: '.' });

      // Owner's list should contain their own but not member's.
      const ownerList = await agent
        .get('/notifications')
        .query({ orgId })
        .set('Authorization', `Bearer ${ownerToken}`);

      const ownerIds = (ownerList.body as Array<{ id: string }>).map((n) => n.id);
      expect(ownerIds).toContain(ownerNotif.body.id as string);
      expect(ownerIds).not.toContain(memberNotif.body.id as string);

      // Member's list should contain their own but not owner's.
      const memberList = await agent
        .get('/notifications')
        .query({ orgId })
        .set('Authorization', `Bearer ${memberToken}`);

      const memberIds = (memberList.body as Array<{ id: string }>).map((n) => n.id);
      expect(memberIds).toContain(memberNotif.body.id as string);
      expect(memberIds).not.toContain(ownerNotif.body.id as string);
    });
  });

  // ── Pagination ─────────────────────────────────────────────────────────────

  describe('Pagination', () => {
    it('respects limit and offset query parameters', async () => {
      const ctx = await seedFullOrg(prisma);
      const ownerToken = generateTestToken({ sub: ctx.owner.auth0Id });
      const { id: userId } = ctx.owner.user;
      const { id: orgId } = ctx.org;

      // Create 5 notifications.
      for (let i = 0; i < 5; i++) {
        await agent
          .post('/notifications')
          .set('Authorization', `Bearer ${ownerToken}`)
          .send({ orgId, userId, type: 'info', title: `Item ${i}`, body: '.' });
      }

      const page1 = await agent
        .get('/notifications')
        .query({ orgId, limit: 3, offset: 0 })
        .set('Authorization', `Bearer ${ownerToken}`);

      const page2 = await agent
        .get('/notifications')
        .query({ orgId, limit: 3, offset: 3 })
        .set('Authorization', `Bearer ${ownerToken}`);

      expect(page1.body).toHaveLength(3);
      expect(page2.body.length).toBeGreaterThanOrEqual(2);

      const page1Ids = (page1.body as Array<{ id: string }>).map((n) => n.id);
      const page2Ids = (page2.body as Array<{ id: string }>).map((n) => n.id);
      const overlap = page1Ids.filter((id) => page2Ids.includes(id));
      expect(overlap).toHaveLength(0);
    });

    it('returns an empty array when offset exceeds total count', async () => {
      const ctx = await seedFullOrg(prisma);
      const token = generateTestToken({ sub: ctx.owner.auth0Id });
      const { id: userId } = ctx.owner.user;
      const { id: orgId } = ctx.org;

      await agent
        .post('/notifications')
        .set('Authorization', `Bearer ${token}`)
        .send({ orgId, userId, type: 'x', title: 'Only one', body: '.' });

      const res = await agent
        .get('/notifications')
        .query({ orgId, limit: 10, offset: 9999 })
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(0);
    });
  });
});
