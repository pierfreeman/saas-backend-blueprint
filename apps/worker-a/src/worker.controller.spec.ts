import { WorkerController, HeavyJobPayload } from './worker.controller';
import type {
  UserInvitedPayload,
  PlanChangedPayload,
  PaymentSucceededPayload,
  SubscriptionCancelledPayload,
} from './worker.controller';
import { JobService } from '@libs/jobs';
import { PubSubService } from '@libs/redis';
import { UserInvitedEmailHandler } from '@libs/memberships';
import { BillingEmailHandler } from '@libs/billing';
import {
  OrgDeletionWorkerService,
  OrgDeletionRequestedEventPayload,
  DeletionTrigger,
} from '@libs/org-deletion';
import { DomainEvent, DOMAIN_EVENTS } from '@libs/events';
import { JobStatus } from '@libs/prisma-business';
import {
  OrgExportWorkerService,
  OrgExportRequestedEventPayload,
} from '@libs/org-export';
import { Mock, vi } from 'vitest';

// ── Fixtures ──────────────────────────────────────────────────────────────────

/** Builds a typed DomainEvent<HeavyJobPayload> for HEAVY_JOB_CREATED tests. */
const makeEvent = (
  override: Partial<DomainEvent<HeavyJobPayload>> = {},
): DomainEvent<HeavyJobPayload> => ({
  eventType: DOMAIN_EVENTS.HEAVY_JOB_CREATED,
  timestamp: new Date(),
  payload: { jobId: 'job_001', tenantId: 'org-1', userId: 'user-1', data: {} },
  tenantId: 'org-1',
  eventId: 'evt-test-1',
  ...override,
});

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockJobRepo = {
  markProcessing: vi.fn(),
  markDone: vi.fn(),
  markFailed: vi.fn(),
} as unknown as JobService;

const mockPubSub = {
  publish: vi.fn(),
} as unknown as PubSubService;

const mockOrgDeletionWorker = {
  scheduleDeletion: vi.fn(),
  executeDeletion: vi.fn(),
} as unknown as OrgDeletionWorkerService;

const mockOrgExportWorker = {
  scheduleExport: vi.fn(),
  executeExport: vi.fn(),
} as unknown as OrgExportWorkerService;

const mockUserInvitedHandler = {
  handle: vi.fn(),
} as unknown as UserInvitedEmailHandler;

const mockBillingEmailHandler = {
  handlePlanChanged: vi.fn(),
  handlePaymentSucceeded: vi.fn(),
  handleSubscriptionCancelled: vi.fn(),
} as unknown as BillingEmailHandler;

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('WorkerController', () => {
  let controller: WorkerController;

  beforeEach(() => {
    vi.clearAllMocks();
    (mockJobRepo.markProcessing as Mock).mockResolvedValue(undefined);
    (mockJobRepo.markDone as Mock).mockResolvedValue(undefined);
    (mockJobRepo.markFailed as Mock).mockResolvedValue(undefined);
    (mockPubSub.publish as Mock).mockResolvedValue(undefined);
    (mockUserInvitedHandler.handle as Mock).mockResolvedValue(undefined);
    (mockBillingEmailHandler.handlePlanChanged as Mock).mockResolvedValue(undefined);
    (mockBillingEmailHandler.handlePaymentSucceeded as Mock).mockResolvedValue(undefined);
    (mockBillingEmailHandler.handleSubscriptionCancelled as Mock).mockResolvedValue(undefined);
    controller = new WorkerController(
      mockJobRepo,
      mockPubSub,
      mockOrgDeletionWorker,
      mockOrgExportWorker,
      mockUserInvitedHandler,
      mockBillingEmailHandler,
    );
  });

  describe('handleHeavyJobCreated', () => {
    it('transitions the job PROCESSING → DONE on success', async () => {
      const event = makeEvent();
      await controller.handleHeavyJobCreated(event);

      expect(mockJobRepo.markProcessing).toHaveBeenCalledWith('job_001');
      expect(mockJobRepo.markDone).toHaveBeenCalledWith(
        'job_001',
        expect.objectContaining({ processed: true, jobId: 'job_001' }),
      );
    });
    it('publishes a PROCESSING message to Redis before work starts', async () => {
      await controller.handleHeavyJobCreated(makeEvent());

      const firstPublish = (mockPubSub.publish as Mock).mock.calls[0];
      expect(firstPublish[0]).toBe('job:update:org-1');
      expect(firstPublish[1]).toMatchObject({
        jobId: 'job_001',
        status: JobStatus.PROCESSING,
        tenantId: 'org-1',
        userId: 'user-1',
      });
    });

    it('publishes a DONE message to Redis on successful completion', async () => {
      await controller.handleHeavyJobCreated(makeEvent());

      const publishCalls = (mockPubSub.publish as Mock).mock.calls;
      expect(publishCalls).toHaveLength(2);

      const donePublish = publishCalls[1];
      expect(donePublish[0]).toBe('job:update:org-1');
      expect(donePublish[1]).toMatchObject({
        jobId: 'job_001',
        status: JobStatus.DONE,
        tenantId: 'org-1',
      });
      expect(donePublish[1].result).toBeDefined();
    });

    it('transitions the job PROCESSING → FAILED and publishes on doWork error', async () => {
      vi.spyOn(controller as any, 'doWork').mockRejectedValueOnce(
        new Error('computation failed'),
      );

      await expect(
        controller.handleHeavyJobCreated(makeEvent()),
      ).rejects.toThrow('computation failed');

      expect(mockJobRepo.markFailed).toHaveBeenCalledWith(
        'job_001',
        'computation failed',
      );

      const publishCalls = (mockPubSub.publish as Mock).mock.calls;
      expect(publishCalls[1][1]).toMatchObject({
        status: JobStatus.FAILED,
        error: 'computation failed',
      });
    });

    it('increments the attempts counter on PROCESSING transition', async () => {
      await controller.handleHeavyJobCreated(makeEvent());
      expect(mockJobRepo.markProcessing).toHaveBeenCalledWith('job_001');
    });

    it('includes userId=undefined in publish when payload has no userId', async () => {
      const event = makeEvent({
        payload: { jobId: 'j2', tenantId: 'org-1', data: {} },
      });
      await controller.handleHeavyJobCreated(event);

      const firstPublish = (mockPubSub.publish as Mock).mock.calls[0];
      expect(firstPublish[1].userId).toBeUndefined();
    });

    it('uses the correct channel for each tenant', async () => {
      const event = makeEvent({
        tenantId: 'org-xyz',
        payload: { jobId: 'j3', tenantId: 'org-xyz', data: {} },
      });
      await controller.handleHeavyJobCreated(event);

      const allChannels = (mockPubSub.publish as Mock).mock.calls.map(
        ([ch]) => ch,
      );
      expect(allChannels).toEqual(['job:update:org-xyz', 'job:update:org-xyz']);
    });

    it('extracts error message from non-Error thrown values', async () => {
      vi.spyOn(controller as any, 'doWork').mockRejectedValueOnce(
        'plain string error',
      );

      await expect(controller.handleHeavyJobCreated(makeEvent())).rejects.toBe(
        'plain string error',
      );

      expect(mockJobRepo.markFailed).toHaveBeenCalledWith(
        'job_001',
        'Unknown error',
      );

      const failedPublish = (mockPubSub.publish as Mock).mock.calls[1][1];
      expect(failedPublish.error).toBe('Unknown error');
    });
  });

  describe('handleOrgDeletionRequested', () => {
    const makeOrgEvent = (
      override: Partial<DomainEvent<OrgDeletionRequestedEventPayload>> = {},
    ): DomainEvent<OrgDeletionRequestedEventPayload> => ({
      eventType: 'org.deletion.requested',
      timestamp: new Date(),
      tenantId: 'org-del-1',
      eventId: 'evt-del-1',
      payload: {
        orgId: 'org-del-1',
        trigger: DeletionTrigger.USER_REQUEST,
        orgName: 'Acme Corp',
        requestedAt: new Date('2026-03-01T00:00:00Z'),
        scheduledAt: new Date('2026-04-01T00:00:00Z'),
      },
      ...override,
    });

    beforeEach(() => {
      (mockOrgDeletionWorker.executeDeletion as Mock).mockResolvedValue(
        undefined,
      );
    });

    it('delegates to OrgDeletionWorkerService with correct arguments', async () => {
      const event = makeOrgEvent();
      await controller.handleOrgDeletionRequested(event);

      expect(mockOrgDeletionWorker.executeDeletion).toHaveBeenCalledTimes(1);
      expect(mockOrgDeletionWorker.executeDeletion).toHaveBeenCalledWith(
        'org-del-1',
        DeletionTrigger.USER_REQUEST,
        'Acme Corp',
        event.payload.requestedAt,
      );
    });

    it('propagates errors thrown by OrgDeletionWorkerService', async () => {
      (mockOrgDeletionWorker.executeDeletion as Mock).mockRejectedValueOnce(
        new Error('deletion failed'),
      );

      await expect(
        controller.handleOrgDeletionRequested(makeOrgEvent()),
      ).rejects.toThrow('deletion failed');
    });

    it('handles SUBSCRIPTION_EXPIRY trigger correctly', async () => {
      const event = makeOrgEvent({
        payload: {
          orgId: 'org-del-2',
          trigger: DeletionTrigger.SUBSCRIPTION_EXPIRY,
          orgName: 'Expired Corp',
          requestedAt: new Date('2026-02-01T00:00:00Z'),
          scheduledAt: new Date('2026-03-01T00:00:00Z'),
        },
      });

      await controller.handleOrgDeletionRequested(event);

      expect(mockOrgDeletionWorker.executeDeletion).toHaveBeenCalledWith(
        'org-del-2',
        DeletionTrigger.SUBSCRIPTION_EXPIRY,
        'Expired Corp',
        event.payload.requestedAt,
      );
    });
  });

  describe('handleOrgExportRequested', () => {
    const makeExportEvent = (
      override: Partial<DomainEvent<OrgExportRequestedEventPayload>> = {},
    ): DomainEvent<OrgExportRequestedEventPayload> => ({
      eventType: 'org.export.requested',
      timestamp: new Date(),
      tenantId: 'org-exp-1',
      eventId: 'evt-exp-1',
      payload: {
        orgId: 'org-exp-1',
        exportId: 'exp-001',
        jobId: 'job-exp-1',
        orgName: 'Export Corp',
        requestedByUserId: 'user-exp-1',
        requestedAt: new Date('2026-03-01T00:00:00Z'),
      },
      ...override,
    });

    beforeEach(() => {
      (mockOrgExportWorker.executeExport as Mock).mockResolvedValue(undefined);
    });

    it('delegates to OrgExportWorkerService with correct arguments', async () => {
      const event = makeExportEvent();
      await controller.handleOrgExportRequested(event);

      expect(mockOrgExportWorker.executeExport).toHaveBeenCalledTimes(1);
      expect(mockOrgExportWorker.executeExport).toHaveBeenCalledWith(
        'org-exp-1',
        'exp-001',
        'job-exp-1',
        'Export Corp',
        'user-exp-1',
        event.payload.requestedAt,
      );
    });

    it('propagates errors thrown by OrgExportWorkerService', async () => {
      (mockOrgExportWorker.executeExport as Mock).mockRejectedValueOnce(
        new Error('export failed'),
      );

      await expect(
        controller.handleOrgExportRequested(makeExportEvent()),
      ).rejects.toThrow('export failed');
    });
  });

  describe('handleUserInvited', () => {
    const makeInviteEvent = (
      override: Partial<DomainEvent<UserInvitedPayload>> = {},
    ): DomainEvent<UserInvitedPayload> => ({
      eventType: DOMAIN_EVENTS.USER_INVITED,
      timestamp: new Date(),
      tenantId: 'org-inv-1',
      eventId: 'evt-inv-1',
      userId: 'inviter-1',
      payload: {
        inviteeName: 'alice@example.com',
        inviteeEmail: 'alice@example.com',
        inviterName: 'inviter-1',
        organizationName: 'Invite Corp',
        organizationId: 'org-inv-1',
        role: 'MEMBER',
        inviteUrl: 'http://localhost:4200/auth/callback',
        expiresAt: new Date('2026-04-07T00:00:00Z'),
      },
      ...override,
    });

    it('delegates to UserInvitedEmailHandler', async () => {
      const event = makeInviteEvent();
      await controller.handleUserInvited(event);

      expect(mockUserInvitedHandler.handle).toHaveBeenCalledWith(event);
    });

    it('propagates errors from UserInvitedEmailHandler', async () => {
      (mockUserInvitedHandler.handle as Mock).mockRejectedValueOnce(
        new Error('email send failed'),
      );

      await expect(
        controller.handleUserInvited(makeInviteEvent()),
      ).rejects.toThrow('email send failed');
    });
  });

  describe('handleBillingPlanChanged', () => {
    const makePlanChangedEvent = (
      override: Partial<DomainEvent<PlanChangedPayload>> = {},
    ): DomainEvent<PlanChangedPayload> => ({
      eventType: DOMAIN_EVENTS.SUBSCRIPTION_PLAN_CHANGED,
      timestamp: new Date(),
      tenantId: 'org-001',
      eventId: 'evt-plan-1',
      payload: {
        orgId: 'org-001',
        subscriptionId: 'sub_001',
        status: 'active',
        cancelAtPeriodEnd: false,
        previousPlanId: 'price_basic',
        newPlanId: 'price_pro',
        planChangeDirection: 'subscription.upgraded',
      },
      ...override,
    });

    it('delegates to BillingEmailHandler.handlePlanChanged', async () => {
      const event = makePlanChangedEvent();
      await controller.handleBillingPlanChanged(event);

      expect(mockBillingEmailHandler.handlePlanChanged).toHaveBeenCalledWith(event);
    });
  });

  describe('handleBillingPaymentSucceeded', () => {
    const makePaymentEvent = (
      override: Partial<DomainEvent<PaymentSucceededPayload>> = {},
    ): DomainEvent<PaymentSucceededPayload> => ({
      eventType: DOMAIN_EVENTS.BILLING_PAYMENT_SUCCEEDED,
      timestamp: new Date(),
      tenantId: 'org-001',
      eventId: 'evt-pay-1',
      payload: {
        orgId: 'org-001',
        invoiceId: 'in_001',
        amountPaid: 2900,
        currency: 'usd',
      },
      ...override,
    });

    it('delegates to BillingEmailHandler.handlePaymentSucceeded', async () => {
      const event = makePaymentEvent();
      await controller.handleBillingPaymentSucceeded(event);

      expect(mockBillingEmailHandler.handlePaymentSucceeded).toHaveBeenCalledWith(event);
    });
  });

  describe('handleBillingSubscriptionCancelled', () => {
    const makeCancelEvent = (
      override: Partial<DomainEvent<SubscriptionCancelledPayload>> = {},
    ): DomainEvent<SubscriptionCancelledPayload> => ({
      eventType: DOMAIN_EVENTS.BILLING_SUBSCRIPTION_CANCELLED,
      timestamp: new Date(),
      tenantId: 'org-001',
      eventId: 'evt-cancel-1',
      payload: {
        orgId: 'org-001',
        subscriptionId: 'sub_001',
        status: 'canceled',
        cancelAtPeriodEnd: false,
      },
      ...override,
    });

    it('delegates to BillingEmailHandler.handleSubscriptionCancelled', async () => {
      const event = makeCancelEvent();
      await controller.handleBillingSubscriptionCancelled(event);

      expect(mockBillingEmailHandler.handleSubscriptionCancelled).toHaveBeenCalledWith(event);
    });
  });
});
