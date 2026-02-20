import { IsNumber, IsPositive, IsString, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class GeneratePresignedPartUrlDto {
  @ApiProperty({ description: 'Part number (1-indexed)' })
  @IsNumber()
  @IsPositive()
  partNumber!: number;

  @ApiPropertyOptional({ description: 'Storage key override' })
  @IsOptional()
  @IsString()
  storageKey?: string;
}
