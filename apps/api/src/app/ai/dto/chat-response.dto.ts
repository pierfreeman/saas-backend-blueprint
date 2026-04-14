import { ApiProperty } from '@nestjs/swagger';

class MessageResponseDto {
  @ApiProperty({ description: 'Message ID', format: 'uuid' })
  id!: string;

  @ApiProperty({ description: 'Message role', enum: ['user', 'assistant', 'system'] })
  role!: 'user' | 'assistant' | 'system';

  @ApiProperty({ description: 'Message content' })
  content!: string;

  @ApiProperty({ description: 'When the message was created' })
  createdAt!: string;
}

export class ChatResponseDto {
  @ApiProperty({ description: 'Conversation ID', format: 'uuid' })
  conversationId!: string;

  @ApiProperty({ description: 'The AI response message', type: MessageResponseDto })
  message!: MessageResponseDto;
}
