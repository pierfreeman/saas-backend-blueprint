import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';

/**
 * StripeClient
 * Infrastructure adapter that wraps the Stripe Node.js SDK.
 *
 * Instantiated once per module (singleton scope). Reads STRIPE_SECRET_KEY from
 * ConfigService on module initialization. Exposes the configured Stripe instance
 * via the `stripe` getter for use by StripeService.
 */
@Injectable()
export class StripeClient implements OnModuleInit {
  private readonly logger = new Logger(StripeClient.name);
  private client!: Stripe;

  constructor(private readonly configService: ConfigService) {}

  onModuleInit(): void {
    const secretKey = this.configService.get<string>('STRIPE_SECRET_KEY');

    if (!secretKey) {
      this.logger.warn(
        'STRIPE_SECRET_KEY is not set — billing calls will fail at runtime',
      );
    }

    this.client = new Stripe(secretKey ?? 'sk_test_placeholder', {
      apiVersion: '2026-04-22.dahlia',
      maxNetworkRetries: 0, // retries are managed at the StripeService layer
      timeout: 30_000,
      telemetry: false,
    });

    this.logger.log('Stripe client initialized');
  }

  get stripe(): Stripe {
    return this.client;
  }
}
