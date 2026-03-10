import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { JobStatus } from '@prisma/client';

export class ExportStatusDto {
  @ApiProperty({
    description: 'Unique identifier of the export job',
    example: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
  })
  id: string;

  @ApiProperty({
    description: 'Current status of the export job',
    enum: JobStatus,
    example: JobStatus.DONE,
  })
  status: JobStatus;

  @ApiPropertyOptional({
    description: 'Pre-signed download URL (only available when status is DONE)',
    example: 'https://s3.amazonaws.com/exports/org-data-123.json?signature=...',
  })
  downloadUrl?: string;

  @ApiPropertyOptional({
    description: 'Error message if the export failed',
    example: 'Failed to generate export: database timeout',
  })
  error?: string;

  @ApiProperty({
    description: 'Timestamp when the export was requested',
    example: '2026-03-10T10:00:00.000Z',
  })
  createdAt: Date;

  @ApiPropertyOptional({
    description: 'Timestamp when the export was completed',
    example: '2026-03-10T10:05:00.000Z',
  })
  finishedAt?: Date | null;
}
