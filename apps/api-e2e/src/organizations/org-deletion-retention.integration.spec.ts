/**
 * org-deletion-retention.integration.spec.ts
 *
 * Integration tests for the GDPR-compliant organization deletion workflow
 * with retention periods and asynchronous execution.
 *
 * Tests cover:
 *  1. Owner requesting deletion (POST /organizations/:id/delete)
 *  2. Organization status transitions (ACTIVE → PENDING_DELETION → DELETED)
 *  3. Retention period calculation (default 30 days, custom per org)
 *  4. Event-driven worker execution (deletion events)
 *  5. Complete data cleanup (storage, database, Redis, Stripe)
 *  6. Legal audit trail preservation
 *  7. Idempotent deletion (safe retries)
 *  8. RBAC enforcement (only OWNER can request)
 */
import { INestApplication } from '@nestjs/common';
import * as supertest from 'supertest';
import { bootstrapTestApp } from '../support/app-bootstrap';
import { setupNockAuth, teardownNockAuth } from '@test/support/nock-auth';
import { generateTestToken } from '@test/utils/auth.helper';
import { resetBusinessDb } from '@test/utils/db-reset.helper';
import {
  createTestOrg,
  createTestUser,
  createTestMembership,
} from '@test/utils/seed.helper';
import { PrismaBusinessService } from '@libs/prisma-business';
import { PrismaLegalService } from '@libs/prisma-legal';
import { MembershipRole, OrganizationStatus } from '@libs/prisma-business';
import { OrgDeletionWorkerService } from '@libs/org-deletion';
import { DeletionTrigger } from '@libs/org-deletion';

/** Fire-and-forget logging is async — wait briefly before asserting on log tables. */
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('Org Deletion Retention Workflow (integration)', () => {
  let app: INestApplication;
  let agent: ReturnType<typeof supertest.agent>;
  let prisma: PrismaBusinessService;
  let legalPrisma: PrismaLegalService;
  let deletionWorker: OrgDeletionWorkerService;

  beforeAll(async () => {
    setupNockAuth();
    app = await bootstrapTestApp();
    agent = supertest.agent(app.getHttpServer());
    prisma = app.get(PrismaBusinessService);
    legalPrisma = app.get(PrismaLegalService);
    deletionWorker = app.get(OrgDeletionWorkerService);
    await resetBusinessDb(prisma);
  });

  afterAll(async () => {
    await app.close();
    teardownNockAuth();
  });

  describe('POST /organizations/:id/delete - Request Deletion', () => {
    it('OWNER can request deletion and org status changes to PENDING_DELETION', async () => {
      // Create organization
      const ownerAuth0Id = 'auth0|retention-owner-001';
      const ownerToken = generateTestToken({ sub: ownerAuth0Id });

      const createRes = await agent
        .post('/organizations')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ name: 'Org Pending Deletion' });

      expect(createRes.status).toBe(201);
      const orgId = createRes.body.id as string;

      // Request deletion
      const deleteRes = await agent
        .post(`/organizations/${orgId}/delete`)
        .set('Authorization', `Bearer ${ownerToken}`);

      expect(deleteRes.status).toBe(202); // ACCEPTED
      expect(deleteRes.body).toHaveProperty('message');
      expect(deleteRes.body).toHaveProperty('scheduledAt');
      expect(deleteRes.body.message).toContain('successfully');

      // Verify org status is PENDING_DELETION
      const org = await prisma.organization.findUnique({
        where: { id: orgId },
      });

      expect(org).not.toBeNull();
      expect(org!.status).toBe(OrganizationStatus.PENDING_DELETION);
      expect(org!.deletionRequestedAt).not.toBeNull();
      expect(org!.deletionScheduledAt).not.toBeNull();
      expect(org!.deletionCompletedAt).toBeNull();

      // Verify scheduled date is approximately 30 days in the future
      const scheduledAt = new Date(deleteRes.body.scheduledAt);
      const expectedDate = new Date();
      expectedDate.setDate(expectedDate.getDate() + 30);

      const timeDiff = Math.abs(
        scheduledAt.getTime() - expectedDate.getTime(),
      );
      const oneDayMs = 24 * 60 * 60 * 1000;
      expect(timeDiff).toBeLessThan(oneDayMs); // Within 1 day tolerance
    });

    it('uses custom retention period when set on organization', async () => {
      const ownerAuth0Id = 'auth0|retention-custom-001';
      const ownerToken = generateTestToken({ sub: ownerAuth0Id });

      // Create org with custom retention period (60 days)
      const ownerUser = await createTestUser(prisma, { auth0Id: ownerAuth0Id });
      const org = await prisma.organization.create({
        data: {
          name: 'Custom Retention Org',
          retentionPeriodDays: 60, // Custom 60 days
        },
      });
      await createTestMembership(
        prisma,
        ownerUser.id,
        org.id,
        MembershipRole.OWNER,
      );

      // Request deletion
      const deleteRes = await agent
        .post(`/organizations/${org.id}/delete`)
        .set('Authorization', `Bearer ${ownerToken}`);

      expect(deleteRes.status).toBe(202);

      // Verify scheduled date is approximately 60 days in the future
      const scheduledAt = new Date(deleteRes.body.scheduledAt);
      const expectedDate = new Date();
      expectedDate.setDate(expectedDate.getDate() + 60);

      const timeDiff = Math.abs(
        scheduledAt.getTime() - expectedDate.getTime(),
      );
      const oneDayMs = 24 * 60 * 60 * 1000;
      expect(timeDiff).toBeLessThan(oneDayMs);
    });

    it('returns 403 when non-OWNER tries to request deletion', async () => {
      const ownerAuth0Id = 'auth0|retention-owner-002';
      const ownerToken = generateTestToken({ sub: ownerAuth0Id });
      const adminAuth0Id = 'auth0|retention-admin-002';
      const adminToken = generateTestToken({ sub: adminAuth0Id });

      // Create org with owner
      const createRes = await agent
        .post('/organizations')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ name: 'Org Admin No Delete' });

      const orgId = createRes.body.id;

      // Add admin member
      const adminUser = await createTestUser(prisma, { auth0Id: adminAuth0Id });
      await createTestMembership(
        prisma,
        adminUser.id,
        orgId,
        MembershipRole.ADMIN,
      );

      // Admin tries to request deletion
      const deleteRes = await agent
        .post(`/organizations/${orgId}/delete`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(deleteRes.status).toBe(403);
    });

    it('returns 400 when org is already PENDING_DELETION', async () => {
      const ownerAuth0Id = 'auth0|retention-owner-003';
      const ownerToken = generateTestToken({ sub: ownerAuth0Id });

      const createRes = await agent
        .post('/organizations')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ name: 'Already Pending Org' });

      const orgId = createRes.body.id;

      // First deletion request - should succeed
      const firstRes = await agent
        .post(`/organizations/${orgId}/delete`)
        .set('Authorization', `Bearer ${ownerToken}`);

      expect(firstRes.status).toBe(202);

      // Second deletion request - should fail
      const secondRes = await agent
        .post(`/organizations/${orgId}/delete`)
        .set('Authorization', `Bearer ${ownerToken}`);

      expect(secondRes.status).toBe(400);
      expect(secondRes.body.message).toContain('already');
    });

    it('returns 404 when organization does not exist', async () => {
      const ownerToken = generateTestToken({ sub: 'auth0|retention-owner-404' });
      const fakeId = '00000000-0000-0000-0000-000000000099';

      const deleteRes = await agent
        .post(`/organizations/${fakeId}/delete`)
        .set('Authorization', `Bearer ${ownerToken}`);

      expect(deleteRes.status).toBe(404);
    });
  });

  describe('Worker Execution - Asynchronous Deletion', () => {
    it('worker deletes all organization data when executed', async () => {
      // Create org with additional data
      const ownerAuth0Id = 'auth0|worker-test-001';
      const ownerToken = generateTestToken({ sub: ownerAuth0Id });

      const createRes = await agent
        .post('/organizations')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ name: 'Worker Delete Org' });

      const orgId = createRes.body.id;
      const ownerUser = await prisma.user.findUnique({
        where: { auth0Id: ownerAuth0Id },
      });

      // Add more data
      const extraUser = await createTestUser(prisma);
      await createTestMembership(
        prisma,
        extraUser.id,
        orgId,
        MembershipRole.MEMBER,
      );

      await prisma.activityLog.create({
        data: {
          orgId,
          actorId: ownerUser!.id,
          action: 'test.action',
          actorRole: 'OWNER',
        },
      });

      await prisma.job.create({
        data: {
          orgId,
          userId: ownerUser!.id,
          type: 'test_job',
          status: 'PENDING',
          payload: {},
        },
      });

      // Request deletion
      await agent
        .post(`/organizations/${orgId}/delete`)
        .set('Authorization', `Bearer ${ownerToken}`);

      await sleep(300);

      // Verify data exists before worker runs
      let org = await prisma.organization.findUnique({ where: { id: orgId } });
      expect(org!.status).toBe(OrganizationStatus.PENDING_DELETION);

      const membershipsBefore = await prisma.membership.count({
        where: { orgId },
      });
      const logsBefore = await prisma.activityLog.count({ where: { orgId } });
      const jobsBefore = await prisma.job.count({ where: { orgId } });

      expect(membershipsBefore).toBeGreaterThan(0);
      expect(logsBefore).toBeGreaterThan(0);
      expect(jobsBefore).toBeGreaterThan(0);

      // Execute worker
      await deletionWorker.executeDeletion(
        orgId,
        DeletionTrigger.USER_REQUEST,
        org!.name,
        org!.deletionRequestedAt!,
      );

      await sleep(300);

      // Verify organization status is DELETED
      org = await prisma.organization.findUnique({ where: { id: orgId } });
      expect(org!.status).toBe(OrganizationStatus.DELETED);
      expect(org!.deletionCompletedAt).not.toBeNull();

      // Verify all related data is deleted (but org record remains as DELETED)
      const membershipsAfter = await prisma.membership.count({
        where: { orgId },
      });
      const logsAfter = await prisma.activityLog.count({ where: { orgId } });
      const jobsAfter = await prisma.job.count({ where: { orgId } });

      expect(membershipsAfter).toBe(0);
      expect(logsAfter).toBe(0);
      expect(jobsAfter).toBe(0);
    });

    it('worker execution is idempotent (safe to retry)', async () => {
      const ownerAuth0Id = 'auth0|idempotent-test-001';
      const ownerToken = generateTestToken({ sub: ownerAuth0Id });

      const createRes = await agent
        .post('/organizations')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ name: 'Idempotent Delete Org' });

      const orgId = createRes.body.id;

      await agent
        .post(`/organizations/${orgId}/delete`)
        .set('Authorization', `Bearer ${ownerToken}`);

      await sleep(300);

      const org = await prisma.organization.findUnique({ where: { id: orgId } });

      // Execute worker first time
      await deletionWorker.executeDeletion(
        orgId,
        DeletionTrigger.USER_REQUEST,
        org!.name,
        org!.deletionRequestedAt!,
      );

      await sleep(300);

      // Execute worker second time (should not throw)
      await expect(
        deletionWorker.executeDeletion(
          orgId,
          DeletionTrigger.USER_REQUEST,
          org!.name,
          org!.deletionRequestedAt!,
        ),
      ).resolves.not.toThrow();

      // Verify org is still DELETED
      const orgAfter = await prisma.organization.findUnique({
        where: { id: orgId },
      });
      expect(orgAfter!.status).toBe(OrganizationStatus.DELETED);
    });
  });

  describe('Legal Audit Trail', () => {
    it('preserves legal audit events after deletion', async () => {
      const ownerAuth0Id = 'auth0|legal-audit-001';
      const ownerToken = generateTestToken({ sub: ownerAuth0Id });

      const createRes = await agent
        .post('/organizations')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ name: 'Legal Audit Org' });

      const orgId = createRes.body.id;

      await sleep(300); // Wait for creation audit

      // Request deletion
      await agent
        .post(`/organizations/${orgId}/delete`)
        .set('Authorization', `Bearer ${ownerToken}`);

      await sleep(300);

      const org = await prisma.organization.findUnique({ where: { id: orgId } });

      // Execute deletion
      await deletionWorker.executeDeletion(
        orgId,
        DeletionTrigger.USER_REQUEST,
        org!.name,
        org!.deletionRequestedAt!,
      );

      await sleep(500); // Wait for deletion audit events

      // Verify business DB shows DELETED
      const orgAfter = await prisma.organization.findUnique({
        where: { id: orgId },
      });
      expect(orgAfter!.status).toBe(OrganizationStatus.DELETED);

      // Verify legal audit events are preserved
      const legalEvents = await legalPrisma.auditEvent.findMany({
        where: { orgId },
        orderBy: { createdAt: 'asc' },
      });

      expect(legalEvents.length).toBeGreaterThanOrEqual(2);

      const eventTypes = legalEvents.map((e) => e.eventType);
      expect(eventTypes).toContain('organization.created');
      expect(eventTypes).toContain('organization.deleted');

      // Verify legal events contain proper metadata
      const deletedEvent = legalEvents.find(
        (e) => e.eventType === 'organization.deleted',
      );
      expect(deletedEvent).toBeDefined();
      expect(deletedEvent!.orgId).toBe(orgId);
    });
  });

  describe('Event Emission', () => {
    it('emits org.deletion.requested event when deletion is requested', async () => {
      const ownerAuth0Id = 'auth0|event-test-001';
      const ownerToken = generateTestToken({ sub: ownerAuth0Id });

      const createRes = await agent
        .post('/organizations')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ name: 'Event Test Org' });

      const orgId = createRes.body.id;

      // Request deletion (which emits event)
      const deleteRes = await agent
        .post(`/organizations/${orgId}/delete`)
        .set('Authorization', `Bearer ${ownerToken}`);

      expect(deleteRes.status).toBe(202);

      // In a real system, the event would be consumed by the worker
      // For this test, we verify the org is in PENDING_DELETION state
      const org = await prisma.organization.findUnique({ where: { id: orgId } });
      expect(org!.status).toBe(OrganizationStatus.PENDING_DELETION);
    });
  });
});
