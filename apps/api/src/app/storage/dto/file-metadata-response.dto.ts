import { ApiProperty } from '@nestjs/swagger';

export class FileMetadataResponseDto {
  @ApiProperty({
    description: 'File identifier',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  id!: string;

  @ApiProperty({
    description: 'Organization identifier',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  orgId!: string;

  @ApiProperty({
    description: 'User who uploaded the file',
    example: '456e7890-e89b-12d3-a456-426614174111',
  })
  uploadedBy!: string;

  @ApiProperty({
    description: 'Storage key (path in object storage)',
    example: 'org/org-uuid/file-uuid',
  })
  storageKey!: string;

  @ApiProperty({
    description: 'Storage provider',
    example: 'S3',
    enum: ['S3', 'AZURE'],
  })
  provider!: string;

  @ApiProperty({
    description: 'Original filename',
    example: 'document.pdf',
  })
  filename!: string;

  @ApiProperty({
    description: 'File size in bytes',
    example: '1048576',
    nullable: true,
  })
  size!: string | null; // bigint serialized as string

  @ApiProperty({
    description: 'File MIME type',
    example: 'application/pdf',
    nullable: true,
  })
  mimeType!: string | null;

  @ApiProperty({
    description: 'File status',
    example: 'COMPLETED',
    enum: ['PENDING', 'COMPLETED', 'EXPIRED', 'ABORTED'],
  })
  status!: string;

  @ApiProperty({
    description: 'Upload URL expiration timestamp',
    example: '2026-03-12T13:00:00.000Z',
    nullable: true,
  })
  expiresAt!: Date | null;

  @ApiProperty({
    description: 'Timestamp when upload was confirmed',
    example: '2026-03-12T12:30:00.000Z',
    nullable: true,
  })
  confirmedAt!: Date | null;

  @ApiProperty({
    description: 'File creation timestamp',
    example: '2026-03-12T12:00:00.000Z',
  })
  createdAt!: Date;

  @ApiProperty({
    description: 'Last update timestamp',
    example: '2026-03-12T12:30:00.000Z',
  })
  updatedAt!: Date;
}
