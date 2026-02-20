import { IsString, IsOptional } from 'class-validator';

export class SuspendOrganizationDto {
  @IsString()
  @IsOptional()
  reason?: string;
}
