import { IsUUID, IsArray, IsOptional } from 'class-validator';

export class MarkAsReadDto {
  @IsArray()
  @IsUUID('4', { each: true })
  @IsOptional()
  notificationIds?: string[];
}
