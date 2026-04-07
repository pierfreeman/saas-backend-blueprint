import {
  IsOptional,
  IsString,
  IsDateString,
  IsInt,
  Min,
  Max,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class ActivityLogQueryDto {
  @ApiProperty({
    required: false,
    description: 'Filter by action prefix (e.g. membership.)',
  })
  @IsOptional()
  @IsString()
  action?: string;

  @ApiProperty({
    required: false,
    description:
      'Comma-separated list of specific action strings (OR logic, takes precedence over action)',
  })
  @IsOptional()
  @IsString()
  actions?: string;

  @ApiProperty({
    required: false,
    description: 'Filter by entity type (e.g. Organization, Membership)',
  })
  @IsOptional()
  @IsString()
  entityType?: string;

  @ApiProperty({
    required: false,
    description: 'Filter by actor user UUID',
  })
  @IsOptional()
  @IsString()
  actorId?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsDateString()
  fromDate?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsDateString()
  toDate?: string;

  @ApiProperty({ required: false, minimum: 1, maximum: 500 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number;

  @ApiProperty({ required: false, minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}
