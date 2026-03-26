import { CheckoutCompletedHandler } from './checkout-completed.handler';
import { SubscriptionService } from '../../application/services/subscription.service';
import Stripe from 'stripe';
import { vi } from 'vitest';

const mockSubscriptionService = {
  handleCheckoutCompleted: vi.fn(),
};

const makeEvent = (
  id: string,
  sessionData: Record<string, unknown> = {},
): Stripe.Event =>
  ({
    id,
    type: 'checkout.session.completed',
    data: {
      object: { id: 'cs_001', object: 'checkout.session', ...sessionData },
    },
  }) as unknown as Stripe.Event;

describe('CheckoutCompletedHandler', () => {
  let handler: CheckoutCompletedHandler;

  beforeEach(() => {
    vi.clearAllMocks();
    handler = new CheckoutCompletedHandler(
      mockSubscriptionService as unknown as SubscriptionService,
    );
  });

  it('delegates to subscriptionService.handleCheckoutCompleted with session and stripeEventId', async () => {
    mockSubscriptionService.handleCheckoutCompleted.mockResolvedValue(
      undefined,
    );
    const event = makeEvent('evt_001');

    await handler.handle(event);

    expect(
      mockSubscriptionService.handleCheckoutCompleted,
    ).toHaveBeenCalledWith(event.data.object, { stripeEventId: 'evt_001' });
  });

  it('passes the exact session object from event.data.object', async () => {
    mockSubscriptionService.handleCheckoutCompleted.mockResolvedValue(
      undefined,
    );
    const event = makeEvent('evt_002', {
      customer: 'cus_abc',
      metadata: { orgId: 'org-x' },
    });

    await handler.handle(event);

    const [sessionArg] =
      mockSubscriptionService.handleCheckoutCompleted.mock.calls[0];
    expect(sessionArg).toBe(event.data.object);
  });

  it('propagates errors thrown by subscriptionService', async () => {
    mockSubscriptionService.handleCheckoutCompleted.mockRejectedValue(
      new Error('DB error'),
    );
    const event = makeEvent('evt_err');

    await expect(handler.handle(event)).rejects.toThrow('DB error');
  });
});
