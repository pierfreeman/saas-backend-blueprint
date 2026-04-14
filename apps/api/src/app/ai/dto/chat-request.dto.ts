import { IsString, IsNotEmpty, IsOptional, IsUUID } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ChatRequestDto {
  @ApiProperty({ description: 'The user message to send to the AI' })
  @IsString()
  @IsNotEmpty()
  message!: string;

  @ApiPropertyOptional({
    description: 'Existing conversation ID to continue',
    format: 'uuid',
  })
  @IsOptional()
  @IsUUID()
  conversationId?: string;
}
