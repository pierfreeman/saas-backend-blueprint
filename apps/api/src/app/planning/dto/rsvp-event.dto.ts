import { IsEnum, IsISO8601, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { RSVPStatus } from '@libs/prisma-business';

export class RsvpEventDto {
  @ApiProperty({
    enum: RSVPStatus,
    description: 'The RSVP status for the authenticated user',
    example: RSVPStatus.YES,
  })
  @IsEnum(RSVPStatus)
  status!: RSVPStatus;

  @ApiPropertyOptional({
    description:
      'For recurring events: the RRULE-generated UTC start of the specific occurrence to RSVP. Omit to apply to the whole series.',
    example: '2026-04-14T10:00:00.000Z',
  })
  @IsOptional()
  @IsISO8601()
  originalStartUtc?: string;
}
