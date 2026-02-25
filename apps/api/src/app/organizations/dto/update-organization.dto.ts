import { IsString, IsNotEmpty, IsEnum, IsOptional } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { OrganizationStatus } from '@prisma/client';

export class UpdateOrganizationDto {
  @ApiPropertyOptional({
    description: 'Organization name',
    example: 'Updated Corp',
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  @ApiPropertyOptional({
    description: 'Organization status',
    enum: OrganizationStatus,
    example: OrganizationStatus.ACTIVE,
  })
  @IsOptional()
  @IsEnum(OrganizationStatus)
  status?: OrganizationStatus;
}
