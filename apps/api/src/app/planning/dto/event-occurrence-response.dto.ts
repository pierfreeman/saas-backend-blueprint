import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { EventAttendeeResponseDto } from './event-attendee-response.dto';

export class EventOccurrenceResponseDto {
  @ApiProperty({
    description: 'UUID of the master Event record.',
    format: 'uuid',
  })
  eventId!: string;

  @ApiProperty({
    description:
      'RRULE-computed start of this occurrence (UTC, ISO 8601). ' +
      'Pass this value as `originalStartUtc` when creating an exception.',
    example: '2026-04-06T09:00:00.000Z',
  })
  originalStartUtc!: Date;

  @ApiProperty({
    description:
      'Effective start time (UTC, ISO 8601). ' +
      'May differ from `originalStartUtc` when overridden by an exception.',
    example: '2026-04-06T09:00:00.000Z',
  })
  startUtc!: Date;

  @ApiProperty({
    description: 'Effective end time (UTC, ISO 8601).',
    example: '2026-04-06T10:00:00.000Z',
  })
  endUtc!: Date;

  @ApiProperty({
    description:
      'Display title. May be overridden by an exception for this occurrence.',
    example: 'Team Weekly Sync',
  })
  title!: string;

  @ApiPropertyOptional({
    description: 'Description. May be overridden by an exception.',
    nullable: true,
  })
  description!: string | null;

  @ApiPropertyOptional({
    description: 'Location. May be overridden by an exception.',
    example: 'Conference Room A',
    nullable: true,
  })
  location!: string | null;

  @ApiProperty({
    description: 'True for all-day events.',
    example: false,
  })
  isAllDay!: boolean;

  @ApiProperty({
    description: 'IANA timezone used for display.',
    example: 'Europe/Rome',
  })
  eventTimezone!: string;

  @ApiPropertyOptional({
    description: 'RFC 5545 RRULE string. Null for single events.',
    example: 'FREQ=WEEKLY;BYDAY=MO,WE,FR',
    nullable: true,
  })
  rrule!: string | null;

  @ApiProperty({
    description: 'True when the master event has a recurrence rule.',
    example: true,
  })
  isRecurring!: boolean;

  @ApiProperty({
    description:
      'True when this occurrence has an overriding EventException record.',
    example: false,
  })
  isException!: boolean;

  @ApiProperty({
    description:
      'True when this occurrence has been cancelled via an exception. ' +
      'Cancelled occurrences are excluded from list results by default.',
    example: false,
  })
  isCancelled!: boolean;

  @ApiProperty({
    description: 'DB user ID of the event creator.',
    format: 'uuid',
  })
  createdByUserId!: string;

  @ApiProperty({
    description: 'UUID of the owning organisation.',
    format: 'uuid',
  })
  orgId!: string;

  @ApiProperty({
    description:
      'Current version of the master event. ' +
      'Supply this value as `version` in PATCH requests (optimistic lock).',
    example: 1,
  })
  version!: number;

  @ApiProperty({
    description: 'All attendees of the master event with their RSVP statuses.',
    type: () => EventAttendeeResponseDto,
    isArray: true,
  })
  attendees!: EventAttendeeResponseDto[];
}
