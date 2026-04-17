import { IsString, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ChatRequestDto {
  @ApiProperty({ description: 'The user message to send to the AI' })
  @IsString()
  @IsNotEmpty()
  message!: string;
}
