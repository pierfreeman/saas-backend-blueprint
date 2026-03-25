import { SubscriptionUpdatedHandler } from './subscription-updated.handler';
import { SubscriptionService } from '../../application/services/subscription.service';
import Stripe from 'stripe';

const mockSubscriptionService = {
  handleSubscriptionUpdated: jest.fn(),
} as unknown as SubscriptionService;

const makeSub = (
  overrides: Partial<Stripe.Subscription> = {},
): Stripe.Subscription =>
  ({
    id: 'sub_001',
    object: 'subscription',
    status: 'active',
    customer: 'cus_001',
    cancel_at_period_end: false,
    items: {
      data: [
        {
          price: { id: 'price_pro' } as Stripe.Price,
          quantity: 3,
        } as Stripe.SubscriptionItem,
      ],
    } as Stripe.ApiList<Stripe.SubscriptionItem>,
    ...overrides,
  }) as unknown as Stripe.Subscription;

const makeEvent = (
  type: string,
  subscription: Stripe.Subscription,
  previousAttributes?: Record<string, unknown>,
): Stripe.Event =>
  ({
    id: 'evt_001',
    type,
    data: {
      object: subscription,
      ...(previousAttributes
        ? { previous_attributes: previousAttributes }
        : {}),
    },
  }) as unknown as Stripe.Event;

describe('SubscriptionUpdatedHandler', () => {
  let handler: SubscriptionUpdatedHandler;

  beforeEach(() => {
    jest.clearAllMocks();
    handler = new SubscriptionUpdatedHandler(mockSubscriptionService);
  });

  it('delegates customer.subscription.updated to SubscriptionService', async () => {
    const sub = makeSub();
    const event = makeEvent('customer.subscription.updated', sub);

    await handler.handle(event);

    expect(
      mockSubscriptionService.handleSubscriptionUpdated,
    ).toHaveBeenCalledWith(sub, {
      eventType: 'customer.subscription.updated',
      stripeEventId: 'evt_001',
      previousPlanId: null,
    });
  });

  it('delegates customer.subscription.deleted without throwing', async () => {
    const sub = makeSub({ status: 'canceled' });
    const event = makeEvent('customer.subscription.deleted', sub);
    (
      mockSubscriptionService.handleSubscriptionUpdated as jest.Mock
    ).mockResolvedValue(undefined);

    await expect(handler.handle(event)).resolves.not.toThrow();
    expect(
      mockSubscriptionService.handleSubscriptionUpdated,
    ).toHaveBeenCalledWith(
      sub,
      expect.objectContaining({ eventType: 'customer.subscription.deleted' }),
    );
  });

  it('extracts previousPlanId from previous_attributes.items.data[0].price.id', async () => {
    const sub = makeSub();
    const previousAttributes = {
      items: {
        data: [{ price: { id: 'price_pro' } }],
      },
    };
    const event = makeEvent(
      'customer.subscription.updated',
      sub,
      previousAttributes,
    );
    (
      mockSubscriptionService.handleSubscriptionUpdated as jest.Mock
    ).mockResolvedValue(undefined);

    await handler.handle(event);

    expect(
      mockSubscriptionService.handleSubscriptionUpdated,
    ).toHaveBeenCalledWith(
      sub,
      expect.objectContaining({ previousPlanId: 'price_pro' }),
    );
  });

  it('sets previousPlanId to null when previous_attributes is absent', async () => {
    const sub = makeSub();
    const event = makeEvent('customer.subscription.updated', sub);
    (
      mockSubscriptionService.handleSubscriptionUpdated as jest.Mock
    ).mockResolvedValue(undefined);

    await handler.handle(event);

    expect(
      mockSubscriptionService.handleSubscriptionUpdated,
    ).toHaveBeenCalledWith(
      sub,
      expect.objectContaining({ previousPlanId: null }),
    );
  });

  it('propagates errors from SubscriptionService', async () => {
    const sub = makeSub();
    const event = makeEvent('customer.subscription.updated', sub);
    (
      mockSubscriptionService.handleSubscriptionUpdated as jest.Mock
    ).mockRejectedValue(new Error('DB error'));

    await expect(handler.handle(event)).rejects.toThrow('DB error');
  });
});
