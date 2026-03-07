import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SubscriptionResponseDto {
  @ApiProperty({ description: 'Organization UUID.', format: 'uuid' })
  orgId!: string;

  @ApiPropertyOptional({
    description:
      'Stripe Customer ID. Null if no Stripe customer has been created yet.',
    example: 'cus_xxx',
  })
  stripeCustomerId!: string | null;

  @ApiPropertyOptional({
    description:
      'Stripe Subscription ID. Null if no active subscription exists.',
    example: 'sub_xxx',
  })
  subscriptionId!: string | null;

  @ApiProperty({
    description:
      'Current billing lifecycle status. Mirrors Stripe subscription statuses.',
    example: 'ACTIVE',
    enum: [
      'NONE',
      'TRIALING',
      'ACTIVE',
      'PAST_DUE',
      'CANCELED',
      'UNPAID',
      'INCOMPLETE',
      'INCOMPLETE_EXPIRED',
      'PAUSED',
    ],
  })
  billingStatus!: string;

  @ApiPropertyOptional({
    description: 'Stripe Price ID of the active plan.',
    example: 'price_xxx',
  })
  planId!: string | null;

  @ApiProperty({
    description: 'Number of billable seats in the current subscription.',
    example: 5,
  })
  seatCount!: number;

  @ApiPropertyOptional({
    description: 'Storage quota in bytes. Null means the plan default applies.',
    example: 107374182400,
    type: 'integer',
  })
  storageLimit!: bigint | null;

  @ApiPropertyOptional({
    description: 'Start of the current billing period (ISO 8601).',
    example: '2026-03-01T00:00:00.000Z',
  })
  subscriptionPeriodStart!: Date | null;

  @ApiPropertyOptional({
    description: 'End of the current billing period (ISO 8601).',
    example: '2026-04-01T00:00:00.000Z',
  })
  subscriptionPeriodEnd!: Date | null;

  @ApiProperty({
    description:
      'If true, the subscription will be canceled at the end of the current billing period.',
    example: false,
  })
  cancelAtPeriodEnd!: boolean;
}
