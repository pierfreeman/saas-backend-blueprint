import { IsISO8601 } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/** Maximum allowed range for a single list query: 365 days. */
export const MAX_RANGE_DAYS = 365;

export class QueryEventsDto {
  @ApiProperty({
    description: 'Range start (UTC, ISO 8601). Inclusive.',
    example: '2026-04-01T00:00:00Z',
  })
  @IsISO8601()
  from!: string;

  @ApiProperty({
    description:
      'Range end (UTC, ISO 8601). Inclusive. Must not be more than 365 days after `from`.',
    example: '2026-04-30T23:59:59Z',
  })
  @IsISO8601()
  to!: string;
}
