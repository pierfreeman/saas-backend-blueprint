import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';

export enum ExportFormat {
  JSON = 'json',
  CSV = 'csv',
}

export class CreateExportDto {
  @ApiPropertyOptional({
    description: 'Export format (defaults to JSON)',
    enum: ExportFormat,
    example: ExportFormat.JSON,
  })
  @IsEnum(ExportFormat)
  @IsOptional()
  format?: ExportFormat = ExportFormat.JSON;
}
