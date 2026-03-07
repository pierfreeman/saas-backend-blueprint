import { IsUUID, IsOptional, IsUrl } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreatePortalSessionDto {
  @ApiProperty({ description: 'Organization UUID', format: 'uuid' })
  @IsUUID()
  orgId!: string;

  @ApiPropertyOptional({
    description: 'URL to return to after leaving the portal',
  })
  @IsOptional()
  @IsUrl()
  returnUrl?: string;
}
