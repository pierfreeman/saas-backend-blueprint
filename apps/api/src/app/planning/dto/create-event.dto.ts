import {
  IsArray,
  IsBoolean,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateEventDto {
  @ApiProperty({
    description: 'Short display title of the event',
    example: 'Team Weekly Sync',
  })
  @IsString()
  @IsNotEmpty()
  title!: string;

  @ApiPropertyOptional({
    description: 'Optional longer description',
    example: 'Weekly alignment meeting for the engineering team',
  })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({
    description: 'Physical or virtual location string',
    example: 'Conference Room A / https://meet.example.com/abc',
  })
  @IsOptional()
  @IsString()
  location?: string;

  @ApiProperty({
    description: 'UTC start datetime as ISO 8601 string',
    example: '2026-04-01T09:00:00Z',
  })
  @IsISO8601()
  start!: string;

  @ApiProperty({
    description: 'UTC end datetime as ISO 8601 string. Must be after start.',
    example: '2026-04-01T10:00:00Z',
  })
  @IsISO8601()
  end!: string;

  @ApiPropertyOptional({
    description:
      'True for all-day events (time component is ignored for display)',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  isAllDay?: boolean;

  @ApiProperty({
    description: 'IANA timezone name used for recurrence expansion and display',
    example: 'Europe/Rome',
  })
  @IsString()
  @IsNotEmpty()
  eventTimezone!: string;

  @ApiPropertyOptional({
    description:
      'RFC 5545 RRULE string. Omit for single (non-recurring) events. ' +
      'The DTSTART is derived from the `start` field and must NOT be included here.',
    example: 'FREQ=WEEKLY;BYDAY=MO,WE,FR',
  })
  @IsOptional()
  @IsString()
  rrule?: string;

  @ApiPropertyOptional({
    description:
      'Pre-parsed UNTIL boundary in UTC (ISO 8601). ' +
      'Should mirror the UNTIL value in `rrule` for efficient range queries.',
    example: '2026-12-31T23:59:59Z',
  })
  @IsOptional()
  @IsISO8601()
  rruleUntilUtc?: string;

  @ApiPropertyOptional({
    description:
      'Array of DB user IDs to invite as attendees. The creator is always added as YES.',
    type: [String],
    example: ['a1b2c3d4-e5f6-7890-ab12-cd34ef567890'],
  })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  attendeeIds?: string[];
}
