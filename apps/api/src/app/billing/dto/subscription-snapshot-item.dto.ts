import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SubscriptionSnapshotItemDto {
  @ApiProperty({ description: 'Snapshot UUID.', format: 'uuid' })
  id!: string;

  @ApiProperty({
    description: 'Stripe Subscription ID recorded at snapshot time.',
    example: 'sub_xxx',
  })
  stripeSubscriptionId!: string;

  @ApiPropertyOptional({
    description: 'Stripe Price ID of the plan recorded at snapshot time.',
    example: 'price_xxx',
  })
  planId!: string | null;

  @ApiProperty({
    description: 'Stripe subscription status string recorded at snapshot time.',
    example: 'active',
  })
  status!: string;

  @ApiPropertyOptional({
    description: 'Number of billable seats recorded at snapshot time.',
    example: 5,
    type: Number,
  })
  seats!: number | null;

  @ApiPropertyOptional({
    description: 'Maximum seats allowed by the plan at snapshot time.',
    example: 10,
    type: Number,
  })
  seatLimit!: number | null;

  @ApiProperty({
    description: 'Start of the billing period recorded at snapshot time (ISO 8601).',
    example: '2026-03-01T00:00:00.000Z',
  })
  periodStart!: Date;

  @ApiProperty({
    description: 'End of the billing period recorded at snapshot time (ISO 8601).',
    example: '2026-04-01T00:00:00.000Z',
  })
  periodEnd!: Date;

  @ApiProperty({
    description: 'Timestamp when the snapshot was created (ISO 8601).',
    example: '2026-03-01T12:34:56.000Z',
  })
  createdAt!: Date;
}
