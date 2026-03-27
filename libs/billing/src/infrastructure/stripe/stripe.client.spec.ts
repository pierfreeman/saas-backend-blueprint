import { StripeClient } from './stripe.client';
import { ConfigService } from '@nestjs/config';
import { vi } from 'vitest';

const mockConfigService = {
  get: vi.fn(),
} as unknown as ConfigService;

describe('StripeClient', () => {
  let client: StripeClient;

  beforeEach(() => {
    vi.clearAllMocks();
    client = new StripeClient(mockConfigService);
  });

  it('initializes without throwing when STRIPE_SECRET_KEY is set', () => {
    mockConfigService.get = vi.fn().mockReturnValue('sk_test_abc123');

    expect(() => client.onModuleInit()).not.toThrow();
  });

  it('initializes with placeholder key when STRIPE_SECRET_KEY is not set', () => {
    mockConfigService.get = vi.fn().mockReturnValue(undefined);

    expect(() => client.onModuleInit()).not.toThrow();
  });

  it('exposes the Stripe instance via the stripe getter after init', () => {
    mockConfigService.get = vi.fn().mockReturnValue('sk_test_abc123');

    client.onModuleInit();

    expect(client.stripe).toBeDefined();
    expect(typeof client.stripe.customers.create).toBe('function');
  });

  it('uses placeholder key when STRIPE_SECRET_KEY is absent', () => {
    mockConfigService.get = vi.fn().mockReturnValue(undefined);

    client.onModuleInit();

    // stripe getter still returns a configured instance (with placeholder key)
    expect(client.stripe).toBeDefined();
  });
});
