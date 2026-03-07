import { ApiProperty } from '@nestjs/swagger';

export class PortalSessionResponseDto {
  @ApiProperty({
    description:
      'Stripe Billing Portal redirect URL. Redirect the user to this URL to manage their subscription.',
    example: 'https://billing.stripe.com/session/xxx',
  })
  url!: string;
}
