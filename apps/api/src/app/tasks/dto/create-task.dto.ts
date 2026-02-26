import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsOptional, IsObject } from 'class-validator';

/**
 * Create Task DTO
 * Validates request body for task creation
 */
export class CreateTaskDto {
  @ApiProperty({
    description: 'Human-readable name of the task to be processed.',
    example: 'Generate monthly report',
  })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiPropertyOptional({
    description:
      'Optional free-text description providing context for the worker.',
    example: 'Aggregate sales data for Q1 2026 across all regions.',
  })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({
    description:
      'Arbitrary JSON payload that is forwarded verbatim to the worker. ' +
      'Must be a plain object; arrays and primitives are rejected.',
    example: { reportType: 'monthly', year: 2026, month: 1, region: 'EU' },
  })
  @IsObject()
  @IsOptional()
  data?: Record<string, any>;
}
