/**
 * job-lifecycle.integration.spec.ts
 *
 * Tests the worker-a job processing pipeline end-to-end:
 *
 *  PENDING → PROCESSING → DONE  (happy path)
 *  PENDING → PROCESSING → FAILED (error path)
 *
 * WorkerController.handleHeavyJobCreated() is invoked directly — no SQS polling.
 * Real Redis (port 6380) receives the pub/sub messages.
 * Real PostgreSQL (port 5440) tracks job status transitions.
 *
 * Pattern:
 *   1. Seed a Job(PENDING) in the business DB
 *   2. Call handleHeavyJobCreated(event)
 *   3. Assert Job.status = DONE in DB
 *   4. Assert Redis pub/sub channel received the correct messages
 */
import { INestApplicationContext } from '@nestjs/common';
import { bootstrapWorkerContext } from '../support/worker-bootstrap';
import {
  WorkerController,
  HeavyJobPayload,
} from '../../../../apps/worker-a/src/worker.controller';
import { PrismaBusinessService } from '@libs/prisma-business';
import { PubSubService } from '@libs/redis';
import { DomainEvent, DOMAIN_EVENTS } from '@libs/events';
import { JobStatus } from '@prisma/client';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.join(process.cwd(), '.env.test') });

describe('Worker-A Job Lifecycle (integration)', () => {
  let ctx: INestApplicationContext;
  let workerController: WorkerController;
  let prisma: PrismaBusinessService;
  let pubSub: PubSubService;

  beforeAll(async () => {
    ctx = await bootstrapWorkerContext();
    workerController = ctx.get(WorkerController);
    prisma = ctx.get(PrismaBusinessService);
    pubSub = ctx.get(PubSubService);
    await prisma.cleanDatabase();
  });

  afterAll(async () => {
    await ctx.close();
  });

  // ─── Helper: seed a PENDING job ───────────────────────────────────────────

  async function seedPendingJob(
    orgId: string,
    userId: string,
  ): Promise<string> {
    const org = await prisma.organization.create({
      data: { name: `Worker Test Org ${orgId}` },
    });
    const user = await prisma.user.create({
      data: {
        auth0Id: `auth0|worker-test-${userId}`,
        email: `worker-${userId}@test.local`,
      },
    });
    await prisma.membership.create({
      data: { userId: user.id, orgId: org.id, role: 'OWNER', status: 'ACTIVE' },
    });
    const job = await prisma.job.create({
      data: {
        orgId: org.id,
        userId: user.id,
        type: 'heavy_job',
        status: JobStatus.PENDING,
        payload: { input: 'test-data' },
      },
    });
    return job.id;
  }

  // ─── Happy path: PENDING → PROCESSING → DONE ──────────────────────────────

  it('transitions job from PENDING → DONE on successful processing', async () => {
    const org = await prisma.organization.create({
      data: { name: 'Worker Happy Path Org' },
    });
    const user = await prisma.user.create({
      data: {
        auth0Id: 'auth0|worker-happy-001',
        email: 'worker-happy@test.local',
      },
    });
    await prisma.membership.create({
      data: { userId: user.id, orgId: org.id, role: 'OWNER', status: 'ACTIVE' },
    });
    const job = await prisma.job.create({
      data: {
        orgId: org.id,
        userId: user.id,
        type: 'heavy_job',
        status: JobStatus.PENDING,
        payload: { input: 'test' },
      },
    });

    const event: DomainEvent<HeavyJobPayload> = {
      eventType: DOMAIN_EVENTS.HEAVY_JOB_CREATED,
      payload: {
        jobId: job.id,
        tenantId: org.id,
        userId: user.id,
        data: { input: 'test' },
      },
      timestamp: new Date().toISOString(),
    };

    await workerController.handleHeavyJobCreated(event);

    const updated = await prisma.job.findUnique({ where: { id: job.id } });
    expect(updated?.status).toBe(JobStatus.DONE);
    expect(updated?.finishedAt).not.toBeNull();
    expect(updated?.result).not.toBeNull();
    expect(updated?.attempts).toBe(1);
  });

  it('increments attempts counter on each processing run', async () => {
    const org = await prisma.organization.create({
      data: { name: 'Worker Attempts Org' },
    });
    const user = await prisma.user.create({
      data: {
        auth0Id: 'auth0|worker-attempts-001',
        email: 'worker-attempts@test.local',
      },
    });
    await prisma.membership.create({
      data: { userId: user.id, orgId: org.id, role: 'OWNER', status: 'ACTIVE' },
    });
    const job = await prisma.job.create({
      data: {
        orgId: org.id,
        userId: user.id,
        type: 'heavy_job',
        status: JobStatus.PENDING,
        payload: {},
      },
    });

    const event: DomainEvent<HeavyJobPayload> = {
      eventType: DOMAIN_EVENTS.HEAVY_JOB_CREATED,
      payload: { jobId: job.id, tenantId: org.id, userId: user.id, data: {} },
      timestamp: new Date().toISOString(),
    };

    await workerController.handleHeavyJobCreated(event);

    const updated = await prisma.job.findUnique({ where: { id: job.id } });
    expect(updated?.attempts).toBeGreaterThanOrEqual(1);
  });

  it('stores the processing result in job.result', async () => {
    const org = await prisma.organization.create({
      data: { name: 'Worker Result Org' },
    });
    const user = await prisma.user.create({
      data: {
        auth0Id: 'auth0|worker-result-001',
        email: 'worker-result@test.local',
      },
    });
    await prisma.membership.create({
      data: { userId: user.id, orgId: org.id, role: 'OWNER', status: 'ACTIVE' },
    });
    const job = await prisma.job.create({
      data: {
        orgId: org.id,
        userId: user.id,
        type: 'heavy_job',
        status: JobStatus.PENDING,
        payload: {},
      },
    });

    const event: DomainEvent<HeavyJobPayload> = {
      eventType: DOMAIN_EVENTS.HEAVY_JOB_CREATED,
      payload: { jobId: job.id, tenantId: org.id, userId: user.id, data: {} },
      timestamp: new Date().toISOString(),
    };

    await workerController.handleHeavyJobCreated(event);

    const updated = await prisma.job.findUnique({ where: { id: job.id } });
    expect(updated?.result).not.toBeNull();
    // The default doWork stub returns { processed: true, jobId, completedAt }
    expect((updated?.result as Record<string, unknown>).processed).toBe(true);
    expect((updated?.result as Record<string, unknown>).jobId).toBe(job.id);
  });

  // ─── Error path: PENDING → PROCESSING → FAILED ────────────────────────────

  it('marks job as FAILED and stores error message when doWork throws', async () => {
    const org = await prisma.organization.create({
      data: { name: 'Worker Error Org' },
    });
    const user = await prisma.user.create({
      data: {
        auth0Id: 'auth0|worker-error-001',
        email: 'worker-error@test.local',
      },
    });
    await prisma.membership.create({
      data: { userId: user.id, orgId: org.id, role: 'OWNER', status: 'ACTIVE' },
    });
    const job = await prisma.job.create({
      data: {
        orgId: org.id,
        userId: user.id,
        type: 'heavy_job',
        status: JobStatus.PENDING,
        payload: {},
      },
    });

    // Spy on doWork to simulate a failure
    const errorMessage = 'Simulated processing failure';
    jest
      .spyOn(
        workerController as unknown as { doWork: () => Promise<unknown> },
        'doWork',
      )
      .mockRejectedValueOnce(new Error(errorMessage));

    const event: DomainEvent<HeavyJobPayload> = {
      eventType: DOMAIN_EVENTS.HEAVY_JOB_CREATED,
      payload: { jobId: job.id, tenantId: org.id, userId: user.id, data: {} },
      timestamp: new Date().toISOString(),
    };

    // handleHeavyJobCreated re-throws so SqsConsumerService can handle DLQ
    await expect(workerController.handleHeavyJobCreated(event)).rejects.toThrow(
      errorMessage,
    );

    const updated = await prisma.job.findUnique({ where: { id: job.id } });
    expect(updated?.status).toBe(JobStatus.FAILED);
    expect(updated?.error).toBe(errorMessage);
    expect(updated?.finishedAt).not.toBeNull();
  });

  // ─── Redis pub/sub messages published ─────────────────────────────────────

  it('publishes PROCESSING and DONE messages to Redis pub/sub channel', async () => {
    const org = await prisma.organization.create({
      data: { name: 'Worker PubSub Org' },
    });
    const user = await prisma.user.create({
      data: {
        auth0Id: 'auth0|worker-pubsub-001',
        email: 'worker-pubsub@test.local',
      },
    });
    await prisma.membership.create({
      data: { userId: user.id, orgId: org.id, role: 'OWNER', status: 'ACTIVE' },
    });
    const job = await prisma.job.create({
      data: {
        orgId: org.id,
        userId: user.id,
        type: 'heavy_job',
        status: JobStatus.PENDING,
        payload: {},
      },
    });

    const publishedMessages: Array<{ channel: string; payload: unknown }> = [];

    // Subscribe to the job update channel before invoking the handler
    const channel = `job:update:${org.id}`;
    await pubSub.subscribe(channel, (payload) => {
      publishedMessages.push({ channel, payload });
    });

    const event: DomainEvent<HeavyJobPayload> = {
      eventType: DOMAIN_EVENTS.HEAVY_JOB_CREATED,
      payload: { jobId: job.id, tenantId: org.id, userId: user.id, data: {} },
      timestamp: new Date().toISOString(),
    };

    await workerController.handleHeavyJobCreated(event);

    // Allow a brief window for pub/sub messages to arrive
    await new Promise((r) => setTimeout(r, 200));

    // Should have received PROCESSING + DONE messages
    expect(publishedMessages.length).toBeGreaterThanOrEqual(2);

    const statuses = publishedMessages.map(
      (m) => (m.payload as { status: string }).status,
    );
    expect(statuses).toContain(JobStatus.PROCESSING);
    expect(statuses).toContain(JobStatus.DONE);
  });
});
