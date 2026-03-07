import { IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CancelSubscriptionDto {
  @ApiProperty({ description: 'Organization UUID', format: 'uuid' })
  @IsUUID()
  orgId!: string;
}
