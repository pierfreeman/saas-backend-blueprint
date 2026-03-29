import { ApiProperty } from '@nestjs/swagger';
import { IsISO8601 } from 'class-validator';

export class QueryConflictsDto {
  @ApiProperty({
    description: 'Conflict range start (UTC, ISO 8601). Inclusive.',
    example: '2026-04-01T09:00:00Z',
  })
  @IsISO8601()
  start!: string;

  @ApiProperty({
    description:
      'Conflict range end (UTC, ISO 8601). Exclusive. Must be after `start`.',
    example: '2026-04-01T10:00:00Z',
  })
  @IsISO8601()
  end!: string;
}
