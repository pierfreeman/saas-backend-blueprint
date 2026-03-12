import { ApiProperty } from '@nestjs/swagger';

export class UploadUrlResponseDto {
  @ApiProperty({
    description: 'Unique file identifier',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  fileId!: string;

  @ApiProperty({
    description: 'Presigned upload URL (PUT request)',
    example: 'https://s3.amazonaws.com/bucket/path?signature=...',
  })
  uploadUrl!: string;

  @ApiProperty({
    description: 'Storage key for the file',
    example: 'org/org-uuid/file-uuid',
  })
  storageKey!: string;

  @ApiProperty({
    description: 'Upload URL expiration timestamp',
    example: '2026-03-12T13:00:00.000Z',
  })
  expiresAt!: Date;
}
