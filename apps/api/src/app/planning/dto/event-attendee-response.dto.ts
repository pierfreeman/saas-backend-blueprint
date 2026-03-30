import { ApiProperty } from '@nestjs/swagger';
import { RSVPStatus } from '@libs/prisma-business';

export class EventAttendeeResponseDto {
  @ApiProperty({ description: 'Attendee record UUID.', format: 'uuid' })
  id!: string;

  @ApiProperty({
    description: 'UUID of the parent event.',
    format: 'uuid',
  })
  eventId!: string;

  @ApiProperty({
    description: 'DB user ID of the attendee.',
    format: 'uuid',
  })
  userId!: string;

  @ApiProperty({
    description: 'RSVP response status.',
    enum: RSVPStatus,
    example: RSVPStatus.YES,
  })
  status!: RSVPStatus;

  @ApiProperty({
    description: 'Timestamp when the attendee was added or invited (ISO 8601).',
    example: '2026-04-01T08:00:00.000Z',
  })
  createdAt!: Date;

  @ApiProperty({
    description: 'Timestamp of the last status change (ISO 8601).',
    example: '2026-04-01T09:30:00.000Z',
  })
  updatedAt!: Date;
}
