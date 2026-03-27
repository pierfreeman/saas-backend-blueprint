import { IsEnum } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { RSVPStatus } from '@prisma/client';

export class RsvpEventDto {
  @ApiProperty({
    enum: RSVPStatus,
    description: 'The RSVP status for the authenticated user',
    example: RSVPStatus.YES,
  })
  @IsEnum(RSVPStatus)
  status!: RSVPStatus;
}
