import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsUUID } from 'class-validator';

export class MarkManyReadDto {
  @ApiProperty({
    description: 'IDs of notifications to mark as read.',
    type: [String],
    format: 'uuid',
  })
  @IsArray()
  @IsUUID('all', { each: true })
  ids!: string[];
}
