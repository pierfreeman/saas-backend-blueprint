import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { JobStatus } from '@libs/prisma-business';

/**
 * JobStatusDto
 * Response shape for GET /tasks/:jobId.
 * Maps 1-to-1 to the Prisma Job model; sensitive fields are excluded.
 */
export class JobStatusDto {
  @ApiProperty({
    description: 'Unique identifier of the job (UUID v4).',
    format: 'uuid',
    example: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
  })
  id: string;

  @ApiProperty({
    description: 'Unique identifier of the job (UUID v4). Alias of id.',
    format: 'uuid',
    example: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
  })
  jobId: string;

  @ApiProperty({
    description: 'Current lifecycle status of the job.',
    enum: JobStatus,
    example: JobStatus.PROCESSING,
  })
  status: JobStatus;

  @ApiProperty({
    description: 'Job type discriminator.',
    example: 'heavy_job',
  })
  type: string;

  @ApiPropertyOptional({
    description:
      'Structured output produced by the worker on successful completion.',
    example: { processed: true, completedAt: '2026-02-27T10:00:00.000Z' },
  })
  result?: unknown;

  @ApiPropertyOptional({
    description:
      'Human-readable error message. Present only when status = FAILED.',
    example: 'Computation exceeded memory limit',
  })
  error?: string;

  @ApiProperty({
    description: 'Number of processing attempts made by any worker instance.',
    example: 1,
  })
  attempts: number;

  @ApiPropertyOptional({
    description:
      'ISO-8601 timestamp when the first PROCESSING transition occurred.',
    type: String,
    format: 'date-time',
    example: '2026-02-27T10:00:01.000Z',
  })
  startedAt?: Date | null;

  @ApiPropertyOptional({
    description:
      'ISO-8601 timestamp when the job reached a terminal state (DONE or FAILED).',
    type: String,
    format: 'date-time',
    example: '2026-02-27T10:00:03.500Z',
  })
  finishedAt?: Date | null;

  @ApiProperty({
    description: 'ISO-8601 timestamp when the job was accepted by the API.',
    type: String,
    format: 'date-time',
    example: '2026-02-27T10:00:00.000Z',
  })
  createdAt: Date;

  @ApiProperty({
    description: 'ISO-8601 timestamp of the last status update.',
    type: String,
    format: 'date-time',
    example: '2026-02-27T10:00:03.500Z',
  })
  updatedAt: Date;
}
