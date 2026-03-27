import { WebhookDispatcherService } from './webhook-dispatcher.service';
import { CheckoutCompletedHandler } from './checkout-completed.handler';
import { SubscriptionCreatedHandler } from './subscription-created.handler';
import { SubscriptionUpdatedHandler } from './subscription-updated.handler';
import { InvoicePaidHandler } from './invoice-paid.handler';
import { InvoiceFailedHandler } from './invoice-failed.handler';
import Stripe from 'stripe';
import { vi } from 'vitest';

// ── Mocks ────────────────────────────────────────────────────────────────────

const mockCheckoutCompletedHandler = { handle: vi.fn() };
const mockSubscriptionCreatedHandler = { handle: vi.fn() };
const mockSubscriptionUpdatedHandler = { handle: vi.fn() };
const mockInvoicePaidHandler = { handle: vi.fn() };
const mockInvoiceFailedHandler = { handle: vi.fn() };

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
    vi.clearAllMocks();
    service = new WebhookDispatcherService(
      mockCheckoutCompletedHandler as unknown as CheckoutCompletedHandler,
      mockSubscriptionCreatedHandler as unknown as SubscriptionCreatedHandler,
      mockSubscriptionUpdatedHandler as unknown as SubscriptionUpdatedHandler,
      mockInvoicePaidHandler as unknown as InvoicePaidHandler,
      mockInvoiceFailedHandler as unknown as InvoiceFailedHandler,
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

  it('routes checkout.session.completed to CheckoutCompletedHandler', async () => {
    mockCheckoutCompletedHandler.handle.mockResolvedValue(undefined);
    const event = makeEvent('checkout.session.completed', {
      id: 'cs_001',
      object: 'checkout.session',
    });

    await service.dispatch(event);

    expect(mockCheckoutCompletedHandler.handle).toHaveBeenCalledWith(event);
  });
});
