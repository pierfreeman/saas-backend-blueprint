import { InvoicePaidHandler } from './invoice-paid.handler';
import { SubscriptionService } from '../../application/services/subscription.service';
import Stripe from 'stripe';
import { Mock, vi } from 'vitest';

const mockSubscriptionService = {
  handleInvoicePaid: vi.fn(),
} as unknown as SubscriptionService;

const makeInvoice = (overrides: Partial<Stripe.Invoice> = {}): Stripe.Invoice =>
  ({
    id: 'in_001',
    object: 'invoice',
    customer: 'cus_001',
    subscription: 'sub_001',
    ...overrides,
  }) as unknown as Stripe.Invoice;

const makeEvent = (invoice: Stripe.Invoice): Stripe.Event =>
  ({
    id: 'evt_001',
    type: 'invoice.payment_succeeded',
    data: { object: invoice },
  }) as unknown as Stripe.Event;

describe('InvoicePaidHandler', () => {
  let handler: InvoicePaidHandler;

  beforeEach(() => {
    vi.clearAllMocks();
    handler = new InvoicePaidHandler(mockSubscriptionService);
  });

  it('delegates to SubscriptionService.handleInvoicePaid with the invoice object', async () => {
    const invoice = makeInvoice();
    const event = makeEvent(invoice);
    (mockSubscriptionService.handleInvoicePaid as Mock).mockResolvedValue(
      undefined,
    );

    await handler.handle(event);

    expect(mockSubscriptionService.handleInvoicePaid).toHaveBeenCalledWith(
      invoice,
    );
  });

  it('resolves without throwing for a well-formed event', async () => {
    const event = makeEvent(makeInvoice());
    (mockSubscriptionService.handleInvoicePaid as Mock).mockResolvedValue(
      undefined,
    );

    await expect(handler.handle(event)).resolves.not.toThrow();
  });

  it('propagates errors from SubscriptionService', async () => {
    const event = makeEvent(makeInvoice());
    (mockSubscriptionService.handleInvoicePaid as Mock).mockRejectedValue(
      new Error('DB error'),
    );

    await expect(handler.handle(event)).rejects.toThrow('DB error');
  });
});
