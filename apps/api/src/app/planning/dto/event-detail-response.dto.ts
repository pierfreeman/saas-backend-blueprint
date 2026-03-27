import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { EventAttendeeResponseDto } from './event-attendee-response.dto';
import { EventExceptionResponseDto } from './event-exception-response.dto';

export class EventDetailResponseDto {
  @ApiProperty({ description: 'Event UUID.', format: 'uuid' })
  id!: string;

  @ApiProperty({
    description: 'UUID of the owning organisation.',
    format: 'uuid',
  })
  orgId!: string;

  @ApiProperty({
    description: 'DB user ID of the member who created the event.',
    format: 'uuid',
  })
  createdByUserId!: string;

  @ApiProperty({
    description: 'Short display title of the event.',
    example: 'Team Weekly Sync',
  })
  title!: string;

  @ApiPropertyOptional({
    description: 'Optional longer description.',
    example: 'Weekly alignment meeting for the engineering team.',
    nullable: true,
  })
  description!: string | null;

  @ApiPropertyOptional({
    description: 'Physical or virtual location string.',
    example: 'Conference Room A / https://meet.example.com/abc',
    nullable: true,
  })
  location!: string | null;

  @ApiProperty({
    description: 'UTC start datetime (ISO 8601).',
    example: '2026-04-01T09:00:00.000Z',
  })
  startUtc!: Date;

  @ApiProperty({
    description: 'UTC end datetime (ISO 8601).',
    example: '2026-04-01T10:00:00.000Z',
  })
  endUtc!: Date;

  @ApiProperty({
    description:
      'True for all-day events (time component is ignored for display).',
    example: false,
  })
  isAllDay!: boolean;

  @ApiProperty({
    description: 'IANA timezone used for recurrence expansion and display.',
    example: 'Europe/Rome',
  })
  eventTimezone!: string;

  @ApiPropertyOptional({
    description:
      'RFC 5545 RRULE string. Null for single (non-recurring) events.',
    example: 'FREQ=WEEKLY;BYDAY=MO,WE,FR',
    nullable: true,
  })
  rrule!: string | null;

  @ApiPropertyOptional({
    description:
      'Pre-parsed UNTIL boundary in UTC (ISO 8601). ' +
      'Mirrors the UNTIL value in `rrule` for efficient range queries.',
    example: '2026-12-31T23:59:59.000Z',
    nullable: true,
  })
  rruleUntilUtc!: Date | null;

  @ApiProperty({
    description:
      'Optimistic-concurrency version counter. Incremented on every update. ' +
      'Supply the current value in PATCH requests to prevent stale updates (409).',
    example: 1,
  })
  version!: number;

  @ApiPropertyOptional({
    description: 'Arbitrary JSON metadata (links, tags, etc.).',
    nullable: true,
  })
  metadata!: unknown | null;

  @ApiPropertyOptional({
    description:
      'Soft-delete timestamp (ISO 8601). Null means the event is active.',
    nullable: true,
  })
  deletedAt!: Date | null;

  @ApiProperty({
    description: 'Immutable creation timestamp (ISO 8601).',
    example: '2026-03-27T12:00:00.000Z',
  })
  createdAt!: Date;

  @ApiProperty({
    description: 'Timestamp of the last update (ISO 8601).',
    example: '2026-03-27T12:00:00.000Z',
  })
  updatedAt!: Date;

  @ApiProperty({
    description:
      'All attendees of this event (including their RSVP statuses).',
    type: () => EventAttendeeResponseDto,
    isArray: true,
  })
  attendees!: EventAttendeeResponseDto[];

  @ApiProperty({
    description:
      'Occurrence-level overrides and cancellations for recurring events.',
    type: () => EventExceptionResponseDto,
    isArray: true,
  })
  exceptions!: EventExceptionResponseDto[];
}
