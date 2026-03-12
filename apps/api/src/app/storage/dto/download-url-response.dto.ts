import { ApiProperty } from '@nestjs/swagger';

export class DownloadUrlResponseDto {
  @ApiProperty({
    description: 'Presigned download URL (GET request)',
    example: 'https://s3.amazonaws.com/bucket/path?signature=...',
  })
  downloadUrl!: string;

  @ApiProperty({
    description: 'Download URL expiration timestamp',
    example: '2026-03-12T13:00:00.000Z',
  })
  expiresAt!: Date;

  @ApiProperty({
    description: 'Original filename',
    example: 'document.pdf',
  })
  filename!: string;

  @ApiProperty({
    description: 'File MIME type',
    example: 'application/pdf',
    nullable: true,
  })
  mimeType!: string | null;

  @ApiProperty({
    description: 'File size in bytes',
    example: 1048576,
    nullable: true,
  })
  size!: string | null; // bigint serialized as string
}
