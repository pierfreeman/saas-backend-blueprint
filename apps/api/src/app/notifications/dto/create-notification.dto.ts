import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';

export class CreateNotificationDto {
  @ApiProperty({ description: 'Target organisation ID.', format: 'uuid' })
  @IsUUID()
  orgId!: string;

  @ApiProperty({ description: 'Recipient user ID.', format: 'uuid' })
  @IsUUID()
  userId!: string;

  @ApiProperty({
    description: 'Notification category (e.g. "invite", "billing").',
    example: 'billing',
  })
  @IsString()
  @IsNotEmpty()
  type!: string;

  @ApiProperty({
    description: 'Short notification title.',
    example: 'Invoice paid',
  })
  @IsString()
  @IsNotEmpty()
  title!: string;

  @ApiProperty({
    description: 'Full notification body text.',
    example: 'Your invoice #1234 has been paid successfully.',
  })
  @IsString()
  @IsNotEmpty()
  body!: string;

  @ApiPropertyOptional({
    description: 'Arbitrary JSON metadata (action links, entity ids, …).',
    example: { invoiceId: 'inv_abc', amount: 9900 },
  })
  @IsObject()
  @IsOptional()
  metadata?: Record<string, unknown>;
}
