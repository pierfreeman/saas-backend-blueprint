import {
  IsBoolean,
  IsISO8601,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateEventDto {
  @ApiProperty({
    description:
      'Current version of the event (optimistic-concurrency lock). ' +
      'Obtained from the event detail response. Request is rejected with 409 if stale.',
    example: 1,
  })
  @IsNumber()
  @Min(1)
  version!: number;

  @ApiPropertyOptional({ example: 'Updated Sprint Planning' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  title?: string;

  @ApiPropertyOptional({ example: 'Moved to Thursdays' })
  @IsOptional()
  @IsString()
  description?: string | null;

  @ApiPropertyOptional({ example: 'Room B' })
  @IsOptional()
  @IsString()
  location?: string | null;

  @ApiPropertyOptional({ example: '2026-04-02T09:00:00Z' })
  @IsOptional()
  @IsISO8601()
  start?: string;

  @ApiPropertyOptional({ example: '2026-04-02T10:00:00Z' })
  @IsOptional()
  @IsISO8601()
  end?: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  isAllDay?: boolean;

  @ApiPropertyOptional({ example: 'America/New_York' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  eventTimezone?: string;

  @ApiPropertyOptional({ example: 'FREQ=WEEKLY;BYDAY=TH' })
  @IsOptional()
  @IsString()
  rrule?: string | null;

  @ApiPropertyOptional({ example: '2026-12-31T23:59:59Z' })
  @IsOptional()
  @IsISO8601()
  rruleUntilUtc?: string | null;

  @ApiPropertyOptional({
    description:
      'When true, all current attendees (except the actor) receive an "event updated" notification.',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  notifyAttendees?: boolean;
}
