import { IsString, IsOptional } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class AbortUploadDto {
  @ApiPropertyOptional({ description: 'Reason for aborting' })
  @IsOptional()
  @IsString()
  reason?: string;
}
