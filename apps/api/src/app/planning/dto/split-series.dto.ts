import {
  IsISO8601,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SplitSeriesDto {
  @ApiProperty({
    description:
      'The RRULE-generated UTC start of the occurrence at which to split (ISO 8601). ' +
      'All occurrences at this timestamp and later will belong to the newly created tail event. ' +
      'Must exactly match an `originalStartUtc` value returned by the list-events endpoint.',
    example: '2026-04-06T10:00:00Z',
  })
  @IsISO8601()
  originalStartUtc!: string;

  @ApiProperty({
    description:
      'Current version of the original event (optimistic-concurrency lock). ' +
      'Obtained from the event detail response. Request is rejected with 409 if stale.',
    example: 1,
  })
  @IsNumber()
  @Min(1)
  version!: number;

  @ApiPropertyOptional({
    description:
      'New title for the tail series. Omit to inherit from the original event.',
    example: 'Rescheduled Sprint Planning',
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  title?: string;

  @ApiPropertyOptional({
    description: 'New description for the tail series. Pass null to clear.',
    example: 'Moved to new timeslot as of Q2.',
    nullable: true,
  })
  @IsOptional()
  @IsString()
  description?: string | null;

  @ApiPropertyOptional({
    description: 'New location for the tail series. Pass null to clear.',
    example: 'Conference Room B',
    nullable: true,
  })
  @IsOptional()
  @IsString()
  location?: string | null;

  @ApiPropertyOptional({
    description:
      'Rescheduled UTC start for the first occurrence of the tail series (ISO 8601). ' +
      "Omit to use the occurrence's original RRULE-computed start.",
    example: '2026-04-06T14:00:00Z',
  })
  @IsOptional()
  @IsISO8601()
  startUtc?: string;

  @ApiPropertyOptional({
    description:
      'Rescheduled UTC end for the first occurrence of the tail series (ISO 8601). ' +
      'Omit to compute from the original event duration.',
    example: '2026-04-06T15:00:00Z',
  })
  @IsOptional()
  @IsISO8601()
  endUtc?: string;
}
