import { ApiProperty } from '@nestjs/swagger';

export class ConfirmUploadResponseDto {
  @ApiProperty({
    description: 'File identifier',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  fileId!: string;

  @ApiProperty({
    description: 'File status after confirmation',
    example: 'COMPLETED',
    enum: ['PENDING', 'COMPLETED', 'EXPIRED', 'ABORTED'],
  })
  status!: string;

  @ApiProperty({
    description: 'Timestamp when upload was confirmed',
    example: '2026-03-12T12:30:00.000Z',
  })
  confirmedAt!: Date;
}
