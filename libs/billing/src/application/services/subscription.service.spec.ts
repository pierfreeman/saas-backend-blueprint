import { Test, TestingModule } from '@nestjs/testing';
import { SubscriptionService, SyncContext } from './subscription.service';
import { BillingRepository } from '../../infrastructure/repositories/billing.repository';
import { ActivityLogService } from '@libs/activity-log';
import { LegalAuditService } from '@libs/legal-audit';
import { EventBusService, DOMAIN_EVENTS } from '@libs/events';
import { BillingStatus as PrismaBillingStatus } from '@prisma/client';
import Stripe from 'stripe';
import { SubscriptionEntity } from '../../domain/entities/subscription.entity';
import { BillingStatus } from '../../domain/enums/billing-status.enum';

// ─── Helpers ────────────────────────────────────────────────────────────────

const NOW_SEC = Math.floor(Date.now() / 1000);

const makeStripeSubscription = (
  overrides: Partial<Stripe.Subscription> = {},
): Stripe.Subscription =>
  ({
    id: 'sub_test_001',
    object: 'subscription',
    status: 'active',
    customer: 'cus_test_001',
    cancel_at_period_end: false,
    items: {
      data: [
        {
          price: { id: 'price_pro' } as Stripe.Price,
          quantity: 3,
          current_period_start: NOW_SEC - 86400,
          current_period_end: NOW_SEC + 86400 * 29,
        } as Stripe.SubscriptionItem,
      ],
    } as Stripe.ApiList<Stripe.SubscriptionItem>,
    ...overrides,
  }) as unknown as Stripe.Subscription;

const makeOrg = (
  overrides: Partial<SubscriptionEntity> = {},
): SubscriptionEntity => ({
  orgId: 'org-001',
  stripeCustomerId: 'cus_test_001',
  subscriptionId: 'sub_old_001',
  billingStatus: BillingStatus.ACTIVE,
  planId: 'price_basic',
  seatCount: 1,
  storageLimit: null,
  subscriptionPeriodStart: null,
  subscriptionPeriodEnd: null,
  cancelAtPeriodEnd: false,
  ...overrides,
});

const makeCtx = (overrides: Partial<SyncContext> = {}): SyncContext => ({
  eventType: 'customer.subscription.updated',
  stripeEventId: 'evt_001',
  ...overrides,
});

// ─── Suite ──────────────────────────────────────────────────────────────────

describe('SubscriptionService', () => {
  let service: SubscriptionService;
  let billingRepository: jest.Mocked<BillingRepository>;
  let activityLog: jest.Mocked<ActivityLogService>;
  let legalAudit: jest.Mocked<LegalAuditService>;
  let eventBus: jest.Mocked<EventBusService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SubscriptionService,
        {
          provide: BillingRepository,
          useValue: {
            findOrgByStripeCustomerId: jest.fn(),
            updateOrgBillingData: jest.fn().mockResolvedValue(undefined),
            updateOrgAndSnapshotTx: jest.fn().mockResolvedValue(undefined),
            createSubscriptionSnapshot: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: ActivityLogService,
          useValue: { logActivity: jest.fn() },
        },
        {
          provide: LegalAuditService,
          useValue: { recordEvent: jest.fn() },
        },
        {
          provide: EventBusService,
          useValue: { publish: jest.fn().mockResolvedValue(undefined) },
        },
      ],
    }).compile();

    service = module.get(SubscriptionService);
    billingRepository = module.get(BillingRepository);
    activityLog = module.get(ActivityLogService);
    legalAudit = module.get(LegalAuditService);
    eventBus = module.get(EventBusService);
  });

  // ─── mapStripeBillingStatus ──────────────────────────────────────────────

  describe('mapStripeBillingStatus', () => {
    it.each([
      ['active', PrismaBillingStatus.ACTIVE],
      ['canceled', PrismaBillingStatus.CANCELED],
      ['trialing', PrismaBillingStatus.TRIALING],
      ['past_due', PrismaBillingStatus.PAST_DUE],
      ['unpaid', PrismaBillingStatus.UNPAID],
      ['incomplete', PrismaBillingStatus.INCOMPLETE],
      ['incomplete_expired', PrismaBillingStatus.INCOMPLETE_EXPIRED],
      ['paused', PrismaBillingStatus.PAUSED],
    ] as [Stripe.Subscription.Status, PrismaBillingStatus][])(
      'maps "%s" to %s',
      (stripeStatus, expected) => {
        expect(service.mapStripeBillingStatus(stripeStatus)).toBe(expected);
      },
    );
  });

  // ─── syncFromStripeSubscription ──────────────────────────────────────────

  describe('syncFromStripeSubscription', () => {
    it('returns null and skips processing when org is not found', async () => {
      billingRepository.findOrgByStripeCustomerId.mockResolvedValue(null);

      const result = await service.syncFromStripeSubscription(
        makeStripeSubscription(),
        makeCtx(),
      );

      expect(result).toBeNull();
      expect(billingRepository.updateOrgAndSnapshotTx).not.toHaveBeenCalled();
    });

    it('calls updateOrgAndSnapshotTx atomically', async () => {
      billingRepository.findOrgByStripeCustomerId.mockResolvedValue(makeOrg());
      const sub = makeStripeSubscription();

      await service.syncFromStripeSubscription(sub, makeCtx());

      expect(billingRepository.updateOrgAndSnapshotTx).toHaveBeenCalledWith(
        'org-001',
        expect.objectContaining({
          subscriptionId: 'sub_test_001',
          billingStatus: PrismaBillingStatus.ACTIVE,
          planId: 'price_pro',
        }),
        expect.objectContaining({
          orgId: 'org-001',
          stripeSubscriptionId: 'sub_test_001',
          planId: 'price_pro',
          status: 'active',
          seats: 3,
        }),
      );
    });

    it('snapshot periodStart/End are derived from SubscriptionItem timestamps', async () => {
      billingRepository.findOrgByStripeCustomerId.mockResolvedValue(makeOrg());
      const sub = makeStripeSubscription();

      await service.syncFromStripeSubscription(sub, makeCtx());

      const [, , snapshotArg] = (
        billingRepository.updateOrgAndSnapshotTx as jest.Mock
      ).mock.calls[0];

      expect(snapshotArg.periodStart).toEqual(
        new Date((NOW_SEC - 86400) * 1000),
      );
      expect(snapshotArg.periodEnd).toEqual(
        new Date((NOW_SEC + 86400 * 29) * 1000),
      );
    });

    it('writes ActivityLog with subscription_created action for created event', async () => {
      billingRepository.findOrgByStripeCustomerId.mockResolvedValue(
        makeOrg({ subscriptionId: null, billingStatus: BillingStatus.NONE }),
      );
      const sub = makeStripeSubscription({ status: 'active' });

      await service.syncFromStripeSubscription(
        sub,
        makeCtx({ eventType: 'customer.subscription.created' }),
      );

      expect(activityLog.logActivity).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'subscription.created',
          orgId: 'org-001',
          metadata: expect.objectContaining({
            stripeSubscriptionId: 'sub_test_001',
            planId: 'price_pro',
          }),
        }),
      );
    });

    it('writes ActivityLog with subscription_cancelled for deleted event', async () => {
      billingRepository.findOrgByStripeCustomerId.mockResolvedValue(makeOrg());
      const sub = makeStripeSubscription({ status: 'canceled' });

      await service.syncFromStripeSubscription(
        sub,
        makeCtx({ eventType: 'customer.subscription.deleted' }),
      );

      expect(activityLog.logActivity).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'subscription.cancelled' }),
      );
    });

    it('writes ActivityLog with subscription_reactivated when recovering from PAST_DUE', async () => {
      billingRepository.findOrgByStripeCustomerId.mockResolvedValue(
        makeOrg({ billingStatus: BillingStatus.PAST_DUE }),
      );
      const sub = makeStripeSubscription({ status: 'active' });

      await service.syncFromStripeSubscription(sub, makeCtx());

      expect(activityLog.logActivity).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'subscription.reactivated' }),
      );
    });

    it('writes ActivityLog with subscription_upgraded when planId changes', async () => {
      billingRepository.findOrgByStripeCustomerId.mockResolvedValue(makeOrg());
      // current org planId = 'price_basic', new = 'price_pro'
      const sub = makeStripeSubscription({ status: 'active' });

      await service.syncFromStripeSubscription(sub, makeCtx());

      expect(activityLog.logActivity).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'subscription.upgraded' }),
      );
    });

    it('writes LegalAuditLog with stripeEventId and subscription metadata', async () => {
      billingRepository.findOrgByStripeCustomerId.mockResolvedValue(makeOrg());

      await service.syncFromStripeSubscription(
        makeStripeSubscription(),
        makeCtx({ stripeEventId: 'evt_legal_001' }),
      );

      expect(legalAudit.recordEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          orgId: 'org-001',
          metadata: expect.objectContaining({
            stripeEventId: 'evt_legal_001',
            stripeSubscriptionId: 'sub_test_001',
            newPlanId: 'price_pro',
          }),
        }),
      );
    });

    it('returns orgId on success', async () => {
      billingRepository.findOrgByStripeCustomerId.mockResolvedValue(makeOrg());

      const result = await service.syncFromStripeSubscription(
        makeStripeSubscription(),
        makeCtx(),
      );

      expect(result).toBe('org-001');
    });
  });

  // ─── handleSubscriptionCreated ───────────────────────────────────────────

  describe('handleSubscriptionCreated', () => {
    it('publishes BILLING_SUBSCRIPTION_CREATED domain event', async () => {
      billingRepository.findOrgByStripeCustomerId.mockResolvedValue(makeOrg());

      await service.handleSubscriptionCreated(
        makeStripeSubscription(),
        makeCtx({ eventType: 'customer.subscription.created' }),
      );

      expect(eventBus.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: DOMAIN_EVENTS.BILLING_SUBSCRIPTION_CREATED,
          payload: expect.objectContaining({ orgId: 'org-001' }),
        }),
      );
    });

    it('does not publish event when org is not found', async () => {
      billingRepository.findOrgByStripeCustomerId.mockResolvedValue(null);

      await service.handleSubscriptionCreated(
        makeStripeSubscription(),
        makeCtx({ eventType: 'customer.subscription.created' }),
      );

      expect(eventBus.publish).not.toHaveBeenCalled();
    });
  });

  // ─── handleSubscriptionUpdated ────────────────────────────────────────────

  describe('handleSubscriptionUpdated', () => {
    it('publishes BILLING_SUBSCRIPTION_CANCELLED for canceled subscription', async () => {
      billingRepository.findOrgByStripeCustomerId.mockResolvedValue(makeOrg());

      await service.handleSubscriptionUpdated(
        makeStripeSubscription({ status: 'canceled' }),
        makeCtx({ eventType: 'customer.subscription.deleted' }),
      );

      expect(eventBus.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: DOMAIN_EVENTS.BILLING_SUBSCRIPTION_CANCELLED,
        }),
      );
    });

    it('does not create duplicate snapshot on retry (idempotency via BillingEvent)', async () => {
      // The idempotency gate lives in WebhookController / BillingEvent table.
      // If the event was already processed the controller returns 200 early
      // and handleSubscriptionUpdated is never called a second time.
      // This test verifies that if it IS called, updateOrgAndSnapshotTx runs exactly once.
      billingRepository.findOrgByStripeCustomerId.mockResolvedValue(makeOrg());

      const sub = makeStripeSubscription();
      const ctx = makeCtx();

      await service.handleSubscriptionUpdated(sub, ctx);

      expect(billingRepository.updateOrgAndSnapshotTx).toHaveBeenCalledTimes(1);
    });

    it('publishes SUBSCRIPTION_PLAN_CHANGED when subscription is still active after update', async () => {
      billingRepository.findOrgByStripeCustomerId.mockResolvedValue(makeOrg());

      await service.handleSubscriptionUpdated(
        makeStripeSubscription({ status: 'active' }),
        makeCtx({ eventType: 'customer.subscription.updated' }),
      );

      expect(eventBus.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: DOMAIN_EVENTS.SUBSCRIPTION_PLAN_CHANGED,
        }),
      );
    });

    it('does not publish event when org is not found', async () => {
      billingRepository.findOrgByStripeCustomerId.mockResolvedValue(null);

      await service.handleSubscriptionUpdated(
        makeStripeSubscription(),
        makeCtx({ eventType: 'customer.subscription.updated' }),
      );

      expect(eventBus.publish).not.toHaveBeenCalled();
    });
  });

  // ─── handleInvoicePaid ────────────────────────────────────────────────────

  describe('handleInvoicePaid', () => {
    const makeInvoice = (
      overrides: Partial<Stripe.Invoice> = {},
    ): Stripe.Invoice =>
      ({
        id: 'in_001',
        object: 'invoice',
        customer: 'cus_test_001',
        amount_paid: 1000,
        currency: 'usd',
        attempt_count: 1,
        ...overrides,
      }) as unknown as Stripe.Invoice;

    it('sets billingStatus to ACTIVE, logs activity and legal event, publishes domain event', async () => {
      billingRepository.findOrgByStripeCustomerId.mockResolvedValue(makeOrg());

      await service.handleInvoicePaid(makeInvoice());

      expect(billingRepository.updateOrgBillingData).toHaveBeenCalledWith(
        'org-001',
        { billingStatus: PrismaBillingStatus.ACTIVE },
      );
      expect(activityLog.logActivity).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'invoice.payment_succeeded' }),
      );
      expect(legalAudit.recordEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'billing.invoice.payment_succeeded',
        }),
      );
      expect(eventBus.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: DOMAIN_EVENTS.BILLING_PAYMENT_SUCCEEDED,
          payload: expect.objectContaining({ invoiceId: 'in_001' }),
        }),
      );
    });

    it('returns early without updating when customerId is missing', async () => {
      await service.handleInvoicePaid(makeInvoice({ customer: null as never }));

      expect(
        billingRepository.findOrgByStripeCustomerId,
      ).not.toHaveBeenCalled();
      expect(billingRepository.updateOrgBillingData).not.toHaveBeenCalled();
    });

    it('returns early without updating when org is not found', async () => {
      billingRepository.findOrgByStripeCustomerId.mockResolvedValue(null);

      await service.handleInvoicePaid(makeInvoice());

      expect(billingRepository.updateOrgBillingData).not.toHaveBeenCalled();
      expect(eventBus.publish).not.toHaveBeenCalled();
    });

    it('extracts customerId when invoice.customer is an object', async () => {
      billingRepository.findOrgByStripeCustomerId.mockResolvedValue(makeOrg());
      const invoice = makeInvoice({
        customer: { id: 'cus_test_001' } as Stripe.Customer,
      });

      await service.handleInvoicePaid(invoice);

      expect(billingRepository.findOrgByStripeCustomerId).toHaveBeenCalledWith(
        'cus_test_001',
      );
    });
  });

  // ─── handleInvoiceFailed ──────────────────────────────────────────────────

  describe('handleInvoiceFailed', () => {
    const makeInvoice = (
      overrides: Partial<Stripe.Invoice> = {},
    ): Stripe.Invoice =>
      ({
        id: 'in_fail_001',
        object: 'invoice',
        customer: 'cus_test_001',
        amount_due: 1000,
        currency: 'usd',
        attempt_count: 2,
        ...overrides,
      }) as unknown as Stripe.Invoice;

    it('sets billingStatus to PAST_DUE, logs activity and legal event, publishes domain event', async () => {
      billingRepository.findOrgByStripeCustomerId.mockResolvedValue(makeOrg());

      await service.handleInvoiceFailed(makeInvoice());

      expect(billingRepository.updateOrgBillingData).toHaveBeenCalledWith(
        'org-001',
        { billingStatus: PrismaBillingStatus.PAST_DUE },
      );
      expect(activityLog.logActivity).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'invoice.payment_failed' }),
      );
      expect(legalAudit.recordEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'billing.invoice.payment_failed',
        }),
      );
      expect(eventBus.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: DOMAIN_EVENTS.BILLING_PAYMENT_FAILED,
          payload: expect.objectContaining({ invoiceId: 'in_fail_001' }),
        }),
      );
    });

    it('returns early without updating when customerId is missing', async () => {
      await service.handleInvoiceFailed(
        makeInvoice({ customer: null as never }),
      );

      expect(
        billingRepository.findOrgByStripeCustomerId,
      ).not.toHaveBeenCalled();
      expect(billingRepository.updateOrgBillingData).not.toHaveBeenCalled();
    });

    it('returns early without updating when org is not found', async () => {
      billingRepository.findOrgByStripeCustomerId.mockResolvedValue(null);

      await service.handleInvoiceFailed(makeInvoice());

      expect(billingRepository.updateOrgBillingData).not.toHaveBeenCalled();
      expect(eventBus.publish).not.toHaveBeenCalled();
    });

    it('extracts customerId when invoice.customer is an object', async () => {
      billingRepository.findOrgByStripeCustomerId.mockResolvedValue(makeOrg());
      const invoice = makeInvoice({
        customer: { id: 'cus_test_001' } as Stripe.Customer,
      });

      await service.handleInvoiceFailed(invoice);

      expect(billingRepository.findOrgByStripeCustomerId).toHaveBeenCalledWith(
        'cus_test_001',
      );
    });
  });

  // ─── syncFromStripeSubscription — additional branches ─────────────────────

  describe('syncFromStripeSubscription — additional branches', () => {
    it('falls through to subscription.updated when plan unchanged and status unchanged', async () => {
      // Same plan, same billing status → action = 'subscription.updated'
      billingRepository.findOrgByStripeCustomerId.mockResolvedValue(
        makeOrg({ planId: 'price_pro', billingStatus: BillingStatus.ACTIVE }),
      );

      await service.syncFromStripeSubscription(
        makeStripeSubscription({ status: 'active' }),
        makeCtx({ eventType: 'customer.subscription.updated' }),
      );

      expect(activityLog.logActivity).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'subscription.updated' }),
      );
    });

    it('uses ctx.previousPlanId to detect upgrade when org planId is null', async () => {
      billingRepository.findOrgByStripeCustomerId.mockResolvedValue(
        makeOrg({ planId: null, billingStatus: BillingStatus.ACTIVE }),
      );

      await service.syncFromStripeSubscription(
        makeStripeSubscription({ status: 'active' }),
        makeCtx({
          eventType: 'customer.subscription.updated',
          previousPlanId: 'price_basic',
        }),
      );

      expect(activityLog.logActivity).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'subscription.upgraded' }),
      );
    });

    it('handles customer as an object (non-string) by extracting .id', async () => {
      billingRepository.findOrgByStripeCustomerId.mockResolvedValue(makeOrg());

      const subWithObjectCustomer = makeStripeSubscription({
        customer: { id: 'cus_test_001' } as Stripe.Customer,
      });

      await service.syncFromStripeSubscription(
        subWithObjectCustomer,
        makeCtx(),
      );

      expect(billingRepository.findOrgByStripeCustomerId).toHaveBeenCalledWith(
        'cus_test_001',
      );
    });

    it('falls back to new Date() for periodStart/End when SubscriptionItem has no timestamps', async () => {
      billingRepository.findOrgByStripeCustomerId.mockResolvedValue(makeOrg());

      const subWithoutPeriod = makeStripeSubscription({
        items: {
          data: [
            {
              price: { id: 'price_pro' } as Stripe.Price,
              quantity: 2,
              // no current_period_start / current_period_end
            } as Stripe.SubscriptionItem,
          ],
        } as Stripe.ApiList<Stripe.SubscriptionItem>,
      });

      await expect(
        service.syncFromStripeSubscription(subWithoutPeriod, makeCtx()),
      ).resolves.not.toThrow();

      const [, , snapshotArg] = (
        billingRepository.updateOrgAndSnapshotTx as jest.Mock
      ).mock.calls[0];
      // Should still be a Date instance
      expect(snapshotArg.periodStart).toBeInstanceOf(Date);
      expect(snapshotArg.periodEnd).toBeInstanceOf(Date);
    });
  });
});
