import { ApiProperty } from '@nestjs/swagger';

export class CancelSubscriptionResponseDto {
  @ApiProperty({
    description: 'Confirmation message.',
    example: 'Subscription will be canceled at the end of the current period.',
  })
  message!: string;
}
