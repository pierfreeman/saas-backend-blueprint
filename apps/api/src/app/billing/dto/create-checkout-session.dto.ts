import { IsString, IsUUID, IsOptional, IsUrl } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateCheckoutSessionDto {
  @ApiProperty({ description: 'Organization UUID', format: 'uuid' })
  @IsUUID()
  orgId!: string;

  @ApiProperty({
    description: 'Stripe Price ID (e.g. price_xxx)',
    example: 'price_xxx',
  })
  @IsString()
  priceId!: string;

  @ApiPropertyOptional({
    description: 'URL to redirect to after successful payment',
  })
  @IsOptional()
  @IsUrl({ require_tld: false })
  successUrl?: string;

  @ApiPropertyOptional({
    description: 'URL to redirect to if the checkout is canceled',
  })
  @IsOptional()
  @IsUrl({ require_tld: false })
  cancelUrl?: string;
}
