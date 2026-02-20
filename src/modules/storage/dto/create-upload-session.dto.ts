import { IsString, IsNotEmpty, IsNumber, IsPositive, IsEnum, IsOptional } from 'class-validator';
import { StorageProvider, FileEntityType } from '@prisma/client';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateUploadSessionDto {
  @ApiProperty({ description: 'File name' })
  @IsString()
  @IsNotEmpty()
  fileName!: string;

  @ApiProperty({ description: 'MIME type', example: 'video/mp4' })
  @IsString()
  @IsNotEmpty()
  mimeType!: string;

  @ApiProperty({ description: 'Expected file size in bytes' })
  @IsNumber()
  @IsPositive()
  expectedSize!: number;

  @ApiProperty({ enum: StorageProvider, description: 'Storage provider' })
  @IsEnum(StorageProvider)
  storageProvider!: StorageProvider;

  @ApiPropertyOptional({ enum: FileEntityType, description: 'Entity type this file belongs to' })
  @IsOptional()
  @IsEnum(FileEntityType)
  entityType?: FileEntityType;

  @ApiPropertyOptional({ description: 'Entity ID this file belongs to' })
  @IsOptional()
  @IsString()
  entityId?: string;

  @ApiPropertyOptional({ description: 'Additional metadata' })
  @IsOptional()
  metadata?: Record<string, unknown>;
}
