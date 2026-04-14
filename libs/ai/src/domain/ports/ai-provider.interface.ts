import { Message } from '../entities/conversation.entity';

export interface AiProvider {
  chat(messages: Message[]): Promise<string>;
  streamChat(
    systemPrompt: string,
    userMessage: string,
  ): AsyncGenerator<string>;
}
