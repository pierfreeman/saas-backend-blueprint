import { IsEnum, IsOptional } from 'class-validator';
import { OrganizationStatus } from '@prisma/client';

export class ListOrganizationsQueryDto {
  @IsEnum(OrganizationStatus)
  @IsOptional()
  status?: OrganizationStatus;
}
