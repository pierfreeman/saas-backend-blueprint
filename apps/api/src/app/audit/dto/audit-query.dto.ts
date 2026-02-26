import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { AUDIT_SEVERITY } from '@libs/audit';
import type { AuditSeverityLevel } from '@libs/audit';

/**
 * Query parameters for `GET /organizations/:orgId/audit`.
 *
 * Validated globally by ValidationPipe (whitelist + transform).
 * Unknown properties are stripped; invalid values return 400.
 */
export class AuditQueryDto {
  @ApiPropertyOptional({
    description:
      'Maximum number of records to return (default: 100, max: 500).',
    example: 50,
    type: Number,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'limit must be an integer' })
  @Min(1, { message: 'limit must be at least 1' })
  limit?: number;

  @ApiPropertyOptional({
    description: 'Number of records to skip for pagination (default: 0).',
    example: 0,
    type: Number,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'offset must be an integer' })
  @Min(0, { message: 'offset cannot be negative' })
  offset?: number;

  @ApiPropertyOptional({
    description:
      'Filter by event-type prefix (e.g. "auth." returns all auth events, ' +
      '"gdpr." returns all GDPR-related events).',
    example: 'auth.',
    type: String,
  })
  @IsOptional()
  @IsString()
  typePrefix?: string;

  @ApiPropertyOptional({
    description: 'Filter by severity level.',
    enum: AUDIT_SEVERITY,
    example: 'HIGH',
  })
  @IsOptional()
  @IsEnum(AUDIT_SEVERITY, {
    message: `severity must be one of: ${Object.keys(AUDIT_SEVERITY).join(', ')}`,
  })
  severity?: AuditSeverityLevel;

  @ApiPropertyOptional({
    description: 'ISO-8601 lower bound for createdAt (inclusive).',
    example: '2026-01-01T00:00:00Z',
    type: String,
  })
  @IsOptional()
  @IsISO8601({}, { message: 'fromDate must be a valid ISO-8601 date string' })
  fromDate?: string;

  @ApiPropertyOptional({
    description: 'ISO-8601 upper bound for createdAt (inclusive).',
    example: '2026-12-31T23:59:59Z',
    type: String,
  })
  @IsOptional()
  @IsISO8601({}, { message: 'toDate must be a valid ISO-8601 date string' })
  toDate?: string;
}
