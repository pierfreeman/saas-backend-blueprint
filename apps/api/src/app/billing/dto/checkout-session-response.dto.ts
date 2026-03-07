import { ApiProperty } from '@nestjs/swagger';

export class CheckoutSessionResponseDto {
  @ApiProperty({
    description:
      'Stripe Checkout redirect URL. Redirect the user to this URL to complete payment.',
    example: 'https://checkout.stripe.com/pay/cs_test_xxx',
  })
  url!: string;

  @ApiProperty({
    description: 'Stripe Checkout Session ID.',
    example: 'cs_test_xxx',
  })
  sessionId!: string;
}
