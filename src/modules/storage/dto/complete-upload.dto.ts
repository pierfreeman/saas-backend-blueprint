import { IsString, IsOptional, IsArray, ValidateNested, IsNumber } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class UploadedPartDto {
  @ApiProperty({ description: 'Part number' })
  @IsNumber()
  partNumber!: number;

  @ApiProperty({ description: 'ETag from provider' })
  @IsString()
  eTag!: string;
}

export class CompleteUploadDto {
  @ApiProperty({ description: 'Storage key where file was uploaded' })
  @IsString()
  storageKey!: string;

  @ApiProperty({ description: 'Final bucket or container name' })
  @IsString()
  bucketOrContainer!: string;

  @ApiPropertyOptional({ description: 'File checksum (MD5, SHA256, etc.)' })
  @IsOptional()
  @IsString()
  checksum?: string;

  @ApiPropertyOptional({
    description: 'Uploaded parts for multipart upload',
    type: [UploadedPartDto],
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UploadedPartDto)
  parts?: UploadedPartDto[];
}
