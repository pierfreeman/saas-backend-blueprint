import {
  IsBoolean,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateExceptionDto {
  @ApiProperty({
    description:
      'The RRULE-generated UTC start of the occurrence to override or cancel (ISO 8601). ' +
      'This is the `originalStartUtc` value from the list-events response.',
    example: '2026-04-06T10:00:00Z',
  })
  @IsISO8601()
  originalStartUtc!: string;

  @ApiPropertyOptional({
    description:
      'Overridden start time (UTC, ISO 8601). Omit to keep the original.',
    example: '2026-04-06T14:00:00Z',
  })
  @IsOptional()
  @IsISO8601()
  startUtc?: string;

  @ApiPropertyOptional({
    description:
      'Overridden end time (UTC, ISO 8601). Omit to compute from original duration.',
    example: '2026-04-06T15:00:00Z',
  })
  @IsOptional()
  @IsISO8601()
  endUtc?: string;

  @ApiPropertyOptional({
    description:
      'When true, this occurrence is cancelled (equivalent to an EXDATE in RFC 5545). ' +
      'Cancelled occurrences are omitted from range-query results.',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  isCancelled?: boolean;

  @ApiPropertyOptional({
    description: 'Overridden title for this occurrence only.',
    example: 'Rescheduled Sprint Planning',
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  title?: string;

  @ApiPropertyOptional({
    description: 'Overridden description for this occurrence only.',
  })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({
    description: 'Overridden location for this occurrence only.',
    example: 'Room C',
  })
  @IsOptional()
  @IsString()
  location?: string;
}
