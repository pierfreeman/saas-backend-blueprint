import { WebhookDispatcherService } from './webhook-dispatcher.service';
import { SubscriptionCreatedHandler } from './handlers/subscription-created.handler';
import { SubscriptionUpdatedHandler } from './handlers/subscription-updated.handler';
import { InvoicePaidHandler } from './handlers/invoice-paid.handler';
import { InvoiceFailedHandler } from './handlers/invoice-failed.handler';
import { BillingRepository } from '../infrastructure/repositories/billing.repository';
import { ActivityLogService } from '@libs/activity-log';
import { LegalAuditService } from '@libs/legal-audit';
import Stripe from 'stripe';

// ── Mocks ────────────────────────────────────────────────────────────────────

const mockSubscriptionCreatedHandler = { handle: jest.fn() };
const mockSubscriptionUpdatedHandler = { handle: jest.fn() };
const mockInvoicePaidHandler = { handle: jest.fn() };
const mockInvoiceFailedHandler = { handle: jest.fn() };
const mockBillingRepository = {
  findOrgById: jest.fn(),
  updateOrgBillingData: jest.fn(),
};
const mockActivityLog = { logActivity: jest.fn() };
const mockLegalAudit = { recordEvent: jest.fn() };

// ── Helpers ──────────────────────────────────────────────────────────────────

const makeEvent = (
  type: string,
  data: Record<string, unknown> = {},
): Stripe.Event =>
  ({
    id: 'evt_001',
    type,
    data: { object: data },
  }) as unknown as Stripe.Event;

const makeSubscriptionEvent = (type: string): Stripe.Event =>
  makeEvent(type, {
    id: 'sub_001',
    object: 'subscription',
    status: 'active',
    customer: 'cus_001',
    items: { data: [{ price: { id: 'price_pro' } }] },
  });

const makeInvoiceEvent = (type: string): Stripe.Event =>
  makeEvent(type, { id: 'in_001', object: 'invoice', customer: 'cus_001' });

// ── Tests ────────────────────────────────────────────────────────────────────

describe('WebhookDispatcherService', () => {
  let service: WebhookDispatcherService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new WebhookDispatcherService(
      mockSubscriptionCreatedHandler as unknown as SubscriptionCreatedHandler,
      mockSubscriptionUpdatedHandler as unknown as SubscriptionUpdatedHandler,
      mockInvoicePaidHandler as unknown as InvoicePaidHandler,
      mockInvoiceFailedHandler as unknown as InvoiceFailedHandler,
      mockBillingRepository as unknown as BillingRepository,
      mockActivityLog as unknown as ActivityLogService,
      mockLegalAudit as unknown as LegalAuditService,
    );
  });

  // ── Event routing ──────────────────────────────────────────────────────────

  it('routes customer.subscription.created to SubscriptionCreatedHandler', async () => {
    mockSubscriptionCreatedHandler.handle.mockResolvedValue(undefined);

    await service.dispatch(
      makeSubscriptionEvent('customer.subscription.created'),
    );

    expect(mockSubscriptionCreatedHandler.handle).toHaveBeenCalledTimes(1);
  });

  it('routes customer.subscription.updated to SubscriptionUpdatedHandler', async () => {
    mockSubscriptionUpdatedHandler.handle.mockResolvedValue(undefined);

    await service.dispatch(
      makeSubscriptionEvent('customer.subscription.updated'),
    );

    expect(mockSubscriptionUpdatedHandler.handle).toHaveBeenCalledTimes(1);
  });

  it('routes customer.subscription.deleted to SubscriptionUpdatedHandler', async () => {
    mockSubscriptionUpdatedHandler.handle.mockResolvedValue(undefined);

    await service.dispatch(
      makeSubscriptionEvent('customer.subscription.deleted'),
    );

    expect(mockSubscriptionUpdatedHandler.handle).toHaveBeenCalledTimes(1);
  });

  it('routes customer.subscription.trial_will_end to SubscriptionUpdatedHandler', async () => {
    mockSubscriptionUpdatedHandler.handle.mockResolvedValue(undefined);

    await service.dispatch(
      makeSubscriptionEvent('customer.subscription.trial_will_end'),
    );

    expect(mockSubscriptionUpdatedHandler.handle).toHaveBeenCalledTimes(1);
  });

  it('routes invoice.payment_succeeded to InvoicePaidHandler', async () => {
    mockInvoicePaidHandler.handle.mockResolvedValue(undefined);

    await service.dispatch(makeInvoiceEvent('invoice.payment_succeeded'));

    expect(mockInvoicePaidHandler.handle).toHaveBeenCalledTimes(1);
  });

  it('routes invoice.payment_failed to InvoiceFailedHandler', async () => {
    mockInvoiceFailedHandler.handle.mockResolvedValue(undefined);

    await service.dispatch(makeInvoiceEvent('invoice.payment_failed'));

    expect(mockInvoiceFailedHandler.handle).toHaveBeenCalledTimes(1);
  });

  it('ignores unknown event types without throwing', async () => {
    await expect(
      service.dispatch(makeEvent('payment_intent.succeeded')),
    ).resolves.not.toThrow();

    expect(mockSubscriptionCreatedHandler.handle).not.toHaveBeenCalled();
    expect(mockInvoicePaidHandler.handle).not.toHaveBeenCalled();
  });

  // ── Error resilience ───────────────────────────────────────────────────────

  it('does NOT rethrow when a handler throws (prevents Stripe retries)', async () => {
    mockSubscriptionCreatedHandler.handle.mockRejectedValue(
      new Error('DB timeout'),
    );

    await expect(
      service.dispatch(makeSubscriptionEvent('customer.subscription.created')),
    ).resolves.not.toThrow();
  });

  // ── checkout.session.completed ─────────────────────────────────────────────

  it('handles checkout.session.completed with a known orgId', async () => {
    mockBillingRepository.findOrgById.mockResolvedValue({
      stripeCustomerId: null,
    });
    mockBillingRepository.updateOrgBillingData.mockResolvedValue(undefined);

    const event = makeEvent('checkout.session.completed', {
      id: 'cs_001',
      object: 'checkout.session',
      customer: 'cus_001',
      mode: 'subscription',
      subscription: 'sub_001',
      metadata: { orgId: 'org-1' },
    });

    await service.dispatch(event);

    expect(mockBillingRepository.updateOrgBillingData).toHaveBeenCalledWith(
      'org-1',
      { stripeCustomerId: 'cus_001' },
    );
    expect(mockActivityLog.logActivity).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'billing.checkout.completed' }),
    );
    expect(mockLegalAudit.recordEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'billing.checkout.completed' }),
    );
  });

  it('skips updateOrgBillingData when org already has stripeCustomerId', async () => {
    mockBillingRepository.findOrgById.mockResolvedValue({
      stripeCustomerId: 'cus_001',
    });

    const event = makeEvent('checkout.session.completed', {
      id: 'cs_002',
      object: 'checkout.session',
      customer: 'cus_001',
      mode: 'subscription',
      subscription: null,
      metadata: { orgId: 'org-1' },
    });

    await service.dispatch(event);

    expect(mockBillingRepository.updateOrgBillingData).not.toHaveBeenCalled();
  });

  it('handles checkout.session.completed without a customerId gracefully', async () => {
    const event = makeEvent('checkout.session.completed', {
      id: 'cs_003',
      object: 'checkout.session',
      customer: null,
      mode: 'subscription',
      metadata: {},
    });

    await expect(service.dispatch(event)).resolves.not.toThrow();
    expect(mockBillingRepository.findOrgById).not.toHaveBeenCalled();
  });

  it('handles checkout.session.completed without orgId in metadata', async () => {
    const event = makeEvent('checkout.session.completed', {
      id: 'cs_004',
      object: 'checkout.session',
      customer: 'cus_999',
      mode: 'subscription',
      metadata: {},
    });

    await expect(service.dispatch(event)).resolves.not.toThrow();
    expect(mockBillingRepository.findOrgById).not.toHaveBeenCalled();
    expect(mockLegalAudit.recordEvent).toHaveBeenCalled();
  });
});
