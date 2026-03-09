import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import { Transform } from 'class-transformer';

export class QueryNotificationsDto {
  @ApiPropertyOptional({
    description: 'Filter by organisation.',
    format: 'uuid',
  })
  @IsUUID()
  @IsOptional()
  orgId?: string;

  @ApiPropertyOptional({
    description: 'Return only unread notifications.',
    default: false,
  })
  @IsBoolean()
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  unreadOnly?: boolean;

  @ApiPropertyOptional({
    description: 'Max results to return.',
    default: 20,
    minimum: 1,
    maximum: 100,
  })
  @IsInt()
  @Min(1)
  @Max(100)
  @IsOptional()
  @Transform(({ value }) => Number.parseInt(value as string, 10))
  limit?: number;

  @ApiPropertyOptional({
    description: 'Number of results to skip.',
    default: 0,
  })
  @IsInt()
  @Min(0)
  @IsOptional()
  @Transform(({ value }) => Number.parseInt(value as string, 10))
  offset?: number;
}
