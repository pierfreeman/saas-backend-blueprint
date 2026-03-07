import { ApiProperty } from '@nestjs/swagger';
import { SubscriptionSnapshotItemDto } from './subscription-snapshot-item.dto';

export class BillingHistoryResponseDto {
  @ApiProperty({
    type: [SubscriptionSnapshotItemDto],
    description: 'Ordered list of subscription snapshots (newest first).',
  })
  items!: SubscriptionSnapshotItemDto[];

  @ApiProperty({
    description: 'Total number of snapshots for this organization.',
    example: 42,
  })
  total!: number;

  @ApiProperty({
    description: 'Maximum number of items returned in this page.',
    example: 50,
  })
  limit!: number;

  @ApiProperty({
    description: 'Number of items skipped.',
    example: 0,
  })
  offset!: number;
}
