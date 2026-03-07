import { Test, TestingModule } from '@nestjs/testing';
import { SubscriptionCreatedHandler } from './subscription-created.handler';
import { SubscriptionService } from '../../application/services/subscription.service';
import Stripe from 'stripe';

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
          current_period_start: Math.floor(Date.now() / 1000) - 86400,
          current_period_end: Math.floor(Date.now() / 1000) + 86400 * 29,
        } as Stripe.SubscriptionItem,
      ],
    } as Stripe.ApiList<Stripe.SubscriptionItem>,
    ...overrides,
  }) as unknown as Stripe.Subscription;

const makeStripeEvent = (
  subscription: Stripe.Subscription,
  eventType = 'customer.subscription.created',
): Stripe.Event =>
  ({
    id: 'evt_test_001',
    type: eventType,
    data: { object: subscription },
  }) as unknown as Stripe.Event;

describe('SubscriptionCreatedHandler', () => {
  let handler: SubscriptionCreatedHandler;
  let subscriptionService: jest.Mocked<SubscriptionService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SubscriptionCreatedHandler,
        {
          provide: SubscriptionService,
          useValue: {
            handleSubscriptionCreated: jest.fn().mockResolvedValue(undefined),
          },
        },
      ],
    }).compile();

    handler = module.get(SubscriptionCreatedHandler);
    subscriptionService = module.get(SubscriptionService);
  });

  it('delegates to SubscriptionService.handleSubscriptionCreated with SyncContext', async () => {
    const subscription = makeStripeSubscription();
    const event = makeStripeEvent(subscription);

    await handler.handle(event);

    expect(subscriptionService.handleSubscriptionCreated).toHaveBeenCalledWith(
      subscription,
      {
        eventType: 'customer.subscription.created',
        stripeEventId: 'evt_test_001',
      },
    );
  });

  it('handles an inactive subscription status without throwing', async () => {
    const subscription = makeStripeSubscription({ status: 'past_due' });
    const event = makeStripeEvent(subscription);

    subscriptionService.handleSubscriptionCreated.mockResolvedValue(undefined);

    await expect(handler.handle(event)).resolves.not.toThrow();
    expect(subscriptionService.handleSubscriptionCreated).toHaveBeenCalledWith(
      subscription,
      expect.objectContaining({ eventType: 'customer.subscription.created' }),
    );
  });

  it('propagates errors from SubscriptionService', async () => {
    const subscription = makeStripeSubscription();
    const event = makeStripeEvent(subscription);

    subscriptionService.handleSubscriptionCreated.mockRejectedValue(
      new Error('DB connection lost'),
    );

    await expect(handler.handle(event)).rejects.toThrow('DB connection lost');
  });
});
