import { InvoiceFailedHandler } from './invoice-failed.handler';
import { SubscriptionService } from '../../application/services/subscription.service';
import Stripe from 'stripe';

const mockSubscriptionService = {
  handleInvoiceFailed: jest.fn(),
} as unknown as SubscriptionService;

const makeInvoice = (overrides: Partial<Stripe.Invoice> = {}): Stripe.Invoice =>
  ({
    id: 'in_001',
    object: 'invoice',
    customer: 'cus_001',
    subscription: 'sub_001',
    attempt_count: 1,
    ...overrides,
  }) as unknown as Stripe.Invoice;

const makeEvent = (invoice: Stripe.Invoice): Stripe.Event =>
  ({
    id: 'evt_001',
    type: 'invoice.payment_failed',
    data: { object: invoice },
  }) as unknown as Stripe.Event;

describe('InvoiceFailedHandler', () => {
  let handler: InvoiceFailedHandler;

  beforeEach(() => {
    jest.clearAllMocks();
    handler = new InvoiceFailedHandler(mockSubscriptionService);
  });

  it('delegates to SubscriptionService.handleInvoiceFailed with the invoice object', async () => {
    const invoice = makeInvoice();
    const event = makeEvent(invoice);
    (
      mockSubscriptionService.handleInvoiceFailed as jest.Mock
    ).mockResolvedValue(undefined);

    await handler.handle(event);

    expect(mockSubscriptionService.handleInvoiceFailed).toHaveBeenCalledWith(
      invoice,
    );
  });

  it('resolves without throwing for a well-formed event', async () => {
    const event = makeEvent(makeInvoice({ attempt_count: 3 }));
    (
      mockSubscriptionService.handleInvoiceFailed as jest.Mock
    ).mockResolvedValue(undefined);

    await expect(handler.handle(event)).resolves.not.toThrow();
  });

  it('propagates errors from SubscriptionService', async () => {
    const event = makeEvent(makeInvoice());
    (
      mockSubscriptionService.handleInvoiceFailed as jest.Mock
    ).mockRejectedValue(new Error('Payment processor unavailable'));

    await expect(handler.handle(event)).rejects.toThrow(
      'Payment processor unavailable',
    );
  });
});
