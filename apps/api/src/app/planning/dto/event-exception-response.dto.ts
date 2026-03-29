import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class EventExceptionResponseDto {
  @ApiProperty({ description: 'Exception record UUID.', format: 'uuid' })
  id!: string;

  @ApiProperty({
    description: 'UUID of the recurring master event.',
    format: 'uuid',
  })
  eventId!: string;

  @ApiProperty({
    description:
      'RRULE-computed start time of the original occurrence (UTC, ISO 8601). ' +
      'Immutable key that identifies which occurrence this exception overrides.',
    example: '2026-04-06T09:00:00.000Z',
  })
  originalStartUtc!: Date;

  @ApiPropertyOptional({
    description:
      'Overridden start time (UTC, ISO 8601). Null means use the RRULE-computed time.',
    example: '2026-04-06T14:00:00.000Z',
    nullable: true,
  })
  startUtc!: Date | null;

  @ApiPropertyOptional({
    description:
      'Overridden end time (UTC, ISO 8601). Null means compute from the original duration.',
    example: '2026-04-06T15:00:00.000Z',
    nullable: true,
  })
  endUtc!: Date | null;

  @ApiProperty({
    description:
      'True when this occurrence has been cancelled (EXDATE equivalent). ' +
      'Cancelled occurrences are excluded from range-query results.',
    example: false,
  })
  isCancelled!: boolean;

  @ApiPropertyOptional({
    description:
      'Overridden title for this occurrence. Null means inherit from the master event.',
    example: 'Rescheduled Sprint Planning',
    nullable: true,
  })
  title!: string | null;

  @ApiPropertyOptional({
    description: 'Overridden description. Null means inherit from the master event.',
    nullable: true,
  })
  description!: string | null;

  @ApiPropertyOptional({
    description: 'Overridden location. Null means inherit from the master event.',
    example: 'Room C',
    nullable: true,
  })
  location!: string | null;

  @ApiProperty({
    description: 'Timestamp when the exception was created (ISO 8601).',
    example: '2026-04-01T10:00:00.000Z',
  })
  createdAt!: Date;
}
