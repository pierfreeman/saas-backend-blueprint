import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';

/**
 * StorageQuotaResponseDto
 * Represents the current storage quota and usage for an organization.
 *
 * BigInt fields are serialized as strings to avoid JSON precision issues.
 */
export class StorageQuotaResponseDto {
  @ApiPropertyOptional({
    description:
      'Total storage quota in bytes. Null means no limit (should not occur with current plans).',
    example: '104857600',
    type: 'string',
  })
  storageLimitBytes!: string | null;

  @ApiProperty({
    description:
      'Total bytes consumed by completed files in this organization.',
    example: '52428800',
    type: 'string',
  })
  storageUsedBytes!: string;

  @ApiProperty({
    description: 'Number of completed files in this organization.',
    example: 12,
  })
  fileCount!: number;

  @ApiPropertyOptional({
    description: 'Maximum number of files allowed. Null means no limit.',
    example: 100,
    type: 'integer',
  })
  fileCountLimit!: number | null;

  @ApiProperty({
    description: 'Maximum size in bytes allowed for a single file upload.',
    example: '52428800',
    type: 'string',
  })
  maxFileSizeBytes!: string;
}
