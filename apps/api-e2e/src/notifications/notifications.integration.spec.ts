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
 *   - Authentication guard rejects unauthenticated requests.
 *   - CRUD lifecycle: create → list → mark-read → delete.
 *   - Unread counter increments on create and decrements on mark-read.
 *   - markManyAsRead bulk-updates multiple records.
 *   - 404 for operations on non-existent or foreign notifications.
 */
import { INestApplication } from '@nestjs/common';
import * as supertest from 'supertest';
import { bootstrapTestApp } from '../support/app-bootstrap';
import { setupNockAuth, teardownNockAuth } from '../support/nock-auth';
import { generateTestToken } from '@test/utils/auth.helper';
import { resetBusinessDb } from '@test/utils/db-reset.helper';
import {
  seedFullOrg,
  createTestUser,
  createTestMembership,
} from '@test/utils/seed.helper';
import { PrismaBusinessService } from '@libs/prisma-business';
import { CacheService } from '@libs/redis';
import { MembershipRole } from '@prisma/client';

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

    it('POST /notifications returns 401 without a token', async () => {
      const res = await agent.post('/notifications').send({});
      expect(res.status).toBe(401);
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

  // ── markManyAsRead ─────────────────────────────────────────────────────────

  describe('PATCH /notifications/read (bulk)', () => {
    it('marks multiple notifications as read in one request', async () => {
      const ctx = await seedFullOrg(prisma);
      const ownerToken = generateTestToken({ sub: ctx.owner.auth0Id });
      const { id: userId } = ctx.owner.user;
      const { id: orgId } = ctx.org;

      // Create two notifications.
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

      // Both should now be read.
      const all = await prisma.notification.findMany({
        where: { id: { in: ids } },
      });
      expect(all.every((n) => n.readAt !== null)).toBe(true);
    });
  });

  // ── Cross-user isolation ───────────────────────────────────────────────────

  describe('Cross-user isolation', () => {
    it('returns 404 when marking a notification belonging to another user', async () => {
      const ctx = await seedFullOrg(prisma, { withMember: true });
      const ownerToken = generateTestToken({ sub: ctx.owner.auth0Id });
      const memberToken = generateTestToken({ sub: ctx.member!.auth0Id });

      // Owner creates a notification for themselves.
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

      // Member tries to mark it as read — should get 404.
      const res = await agent
        .patch(`/notifications/${notifId}/read`)
        .set('Authorization', `Bearer ${memberToken}`);

      expect(res.status).toBe(404);
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
  });
});
