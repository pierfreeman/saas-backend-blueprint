import { Test, TestingModule } from '@nestjs/testing';
import { Mocked, vi } from 'vitest';
import { DOMAIN_EVENTS, DomainEvent } from '@libs/events';
import { EmailService } from '@libs/email';
import { BillingRepository } from '../../infrastructure/repositories/billing.repository';
import {
  BillingEmailHandler,
  PlanChangedPayload,
  PaymentSucceededPayload,
  SubscriptionCancelledPayload,
} from './billing-email.handler';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeOrgMeta(
  overrides: Partial<{ name: string; ownerEmail: string | null }> = {},
) {
  return { name: 'Acme Corp', ownerEmail: 'owner@acme.com', ...overrides };
}

function makePlanChangedEvent(
  overrides: Partial<DomainEvent<PlanChangedPayload>> = {},
): DomainEvent<PlanChangedPayload> {
  return {
    eventType: DOMAIN_EVENTS.SUBSCRIPTION_PLAN_CHANGED,
    timestamp: new Date('2026-01-01T00:00:00.000Z'),
    payload: {
      orgId: 'org-001',
      subscriptionId: 'sub_001',
      status: 'active',
      cancelAtPeriodEnd: false,
      previousPlanId: 'price_basic',
      newPlanId: 'price_pro',
      planChangeDirection: 'subscription.upgraded',
    },
    tenantId: 'org-001',
    ...overrides,
  };
}

function makePaymentSucceededEvent(
  overrides: Partial<DomainEvent<PaymentSucceededPayload>> = {},
): DomainEvent<PaymentSucceededPayload> {
  return {
    eventType: DOMAIN_EVENTS.BILLING_PAYMENT_SUCCEEDED,
    timestamp: new Date('2026-01-01T00:00:00.000Z'),
    payload: {
      orgId: 'org-001',
      invoiceId: 'in_001',
      amountPaid: 2900,
      currency: 'usd',
    },
    tenantId: 'org-001',
    ...overrides,
  };
}

function makeCancelledEvent(
  overrides: Partial<DomainEvent<SubscriptionCancelledPayload>> = {},
): DomainEvent<SubscriptionCancelledPayload> {
  return {
    eventType: DOMAIN_EVENTS.BILLING_SUBSCRIPTION_CANCELLED,
    timestamp: new Date('2026-01-01T00:00:00.000Z'),
    payload: {
      orgId: 'org-001',
      subscriptionId: 'sub_001',
      status: 'canceled',
      cancelAtPeriodEnd: false,
    },
    tenantId: 'org-001',
    ...overrides,
  };
}

// ── Suite ─────────────────────────────────────────────────────────────────────

describe('BillingEmailHandler', () => {
  let handler: BillingEmailHandler;
  let emailService: Mocked<EmailService>;
  let billingRepository: Mocked<Pick<BillingRepository, 'findOrgMeta'>>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BillingEmailHandler,
        {
          provide: EmailService,
          useValue: {
            sendTransactionalEmail: vi.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: BillingRepository,
          useValue: {
            findOrgMeta: vi.fn().mockResolvedValue(makeOrgMeta()),
          },
        },
      ],
    }).compile();

    handler = module.get(BillingEmailHandler);
    emailService = module.get(EmailService);
    billingRepository = module.get(BillingRepository);
  });

  // ── handlePlanChanged ─────────────────────────────────────────────────────

  describe('handlePlanChanged', () => {
    it('sends billing-plan-upgraded template when planChangeDirection is subscription.upgraded', async () => {
      await handler.handlePlanChanged(makePlanChangedEvent());

      expect(emailService.sendTransactionalEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          templateName: 'billing-plan-upgraded',
          recipient: 'owner@acme.com',
          data: expect.objectContaining({
            previousPlanId: 'price_basic',
            newPlanId: 'price_pro',
            organizationName: 'Acme Corp',
          }),
        }),
      );
    });

    it('sends billing-plan-downgraded template for any other direction', async () => {
      await handler.handlePlanChanged(
        makePlanChangedEvent({
          payload: {
            orgId: 'org-001',
            subscriptionId: 'sub_001',
            status: 'active',
            cancelAtPeriodEnd: false,
            previousPlanId: 'price_pro',
            newPlanId: 'price_basic',
            planChangeDirection: 'subscription.updated',
          },
        }),
      );

      expect(emailService.sendTransactionalEmail).toHaveBeenCalledWith(
        expect.objectContaining({ templateName: 'billing-plan-downgraded' }),
      );
    });

    it('uses "N/A" when previousPlanId is null', async () => {
      await handler.handlePlanChanged(
        makePlanChangedEvent({
          payload: {
            orgId: 'org-001',
            subscriptionId: 'sub_001',
            status: 'active',
            cancelAtPeriodEnd: false,
            previousPlanId: null,
            newPlanId: 'price_pro',
            planChangeDirection: 'subscription.upgraded',
          },
        }),
      );

      expect(emailService.sendTransactionalEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ previousPlanId: 'N/A' }),
        }),
      );
    });

    it('uses "N/A" when newPlanId is null', async () => {
      await handler.handlePlanChanged(
        makePlanChangedEvent({
          payload: {
            orgId: 'org-001',
            subscriptionId: 'sub_001',
            status: 'active',
            cancelAtPeriodEnd: false,
            previousPlanId: 'price_pro',
            newPlanId: null,
            planChangeDirection: 'subscription.updated',
          },
        }),
      );

      expect(emailService.sendTransactionalEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ newPlanId: 'N/A' }),
        }),
      );
    });

    it('skips sending when ownerEmail is null', async () => {
      (
        billingRepository.findOrgMeta as ReturnType<typeof vi.fn>
      ).mockResolvedValue(makeOrgMeta({ ownerEmail: null }));

      await handler.handlePlanChanged(makePlanChangedEvent());

      expect(emailService.sendTransactionalEmail).not.toHaveBeenCalled();
    });

    it('swallows errors from EmailService without rethrowing', async () => {
      (
        emailService.sendTransactionalEmail as ReturnType<typeof vi.fn>
      ).mockRejectedValue(new Error('SMTP failure'));

      await expect(
        handler.handlePlanChanged(makePlanChangedEvent()),
      ).resolves.toBeUndefined();
    });

    it('swallows errors from BillingRepository without rethrowing', async () => {
      (
        billingRepository.findOrgMeta as ReturnType<typeof vi.fn>
      ).mockRejectedValue(new Error('DB failure'));

      await expect(
        handler.handlePlanChanged(makePlanChangedEvent()),
      ).resolves.toBeUndefined();
    });

    it('swallows non-Error thrown by BillingRepository without rethrowing', async () => {
      (
        billingRepository.findOrgMeta as ReturnType<typeof vi.fn>
      ).mockRejectedValue('plain string failure');

      await expect(
        handler.handlePlanChanged(makePlanChangedEvent()),
      ).resolves.toBeUndefined();
    });
  });

  // ── handlePaymentSucceeded ────────────────────────────────────────────────

  describe('handlePaymentSucceeded', () => {
    it('sends billing-payment-received template with correct recipient and amount', async () => {
      await handler.handlePaymentSucceeded(makePaymentSucceededEvent());

      expect(emailService.sendTransactionalEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          templateName: 'billing-payment-received',
          recipient: 'owner@acme.com',
          data: expect.objectContaining({
            amountPaid: '29.00',
            currency: 'USD',
            invoiceId: 'in_001',
            organizationName: 'Acme Corp',
          }),
        }),
      );
    });

    it('formats amount correctly (cents to major unit)', async () => {
      await handler.handlePaymentSucceeded(
        makePaymentSucceededEvent({
          payload: {
            orgId: 'org-001',
            invoiceId: 'in_002',
            amountPaid: 9900,
            currency: 'eur',
          },
        }),
      );

      expect(emailService.sendTransactionalEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            amountPaid: '99.00',
            currency: 'EUR',
          }),
        }),
      );
    });

    it('skips sending when ownerEmail is null', async () => {
      (
        billingRepository.findOrgMeta as ReturnType<typeof vi.fn>
      ).mockResolvedValue(makeOrgMeta({ ownerEmail: null }));

      await handler.handlePaymentSucceeded(makePaymentSucceededEvent());

      expect(emailService.sendTransactionalEmail).not.toHaveBeenCalled();
    });

    it('swallows errors without rethrowing', async () => {
      (
        emailService.sendTransactionalEmail as ReturnType<typeof vi.fn>
      ).mockRejectedValue(new Error('provider down'));

      await expect(
        handler.handlePaymentSucceeded(makePaymentSucceededEvent()),
      ).resolves.toBeUndefined();
    });

    it('swallows non-Error thrown by BillingRepository without rethrowing', async () => {
      (
        billingRepository.findOrgMeta as ReturnType<typeof vi.fn>
      ).mockRejectedValue('plain string failure');

      await expect(
        handler.handlePaymentSucceeded(makePaymentSucceededEvent()),
      ).resolves.toBeUndefined();
    });
  });

  // ── handleSubscriptionCancelled ───────────────────────────────────────────

  describe('handleSubscriptionCancelled', () => {
    it('sends billing-plan-cancelled template with correct recipient', async () => {
      await handler.handleSubscriptionCancelled(makeCancelledEvent());

      expect(emailService.sendTransactionalEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          templateName: 'billing-plan-cancelled',
          recipient: 'owner@acme.com',
          subject: expect.stringContaining('Acme Corp'),
          data: expect.objectContaining({
            organizationName: 'Acme Corp',
          }),
        }),
      );
    });

    it('skips sending when ownerEmail is null', async () => {
      (
        billingRepository.findOrgMeta as ReturnType<typeof vi.fn>
      ).mockResolvedValue(makeOrgMeta({ ownerEmail: null }));

      await handler.handleSubscriptionCancelled(makeCancelledEvent());

      expect(emailService.sendTransactionalEmail).not.toHaveBeenCalled();
    });

    it('swallows errors without rethrowing', async () => {
      (
        emailService.sendTransactionalEmail as ReturnType<typeof vi.fn>
      ).mockRejectedValue(new Error('timeout'));

      await expect(
        handler.handleSubscriptionCancelled(makeCancelledEvent()),
      ).resolves.toBeUndefined();
    });

    it('swallows non-Error thrown by BillingRepository without rethrowing', async () => {
      (
        billingRepository.findOrgMeta as ReturnType<typeof vi.fn>
      ).mockRejectedValue('plain string failure');

      await expect(
        handler.handleSubscriptionCancelled(makeCancelledEvent()),
      ).resolves.toBeUndefined();
    });
  });
});
