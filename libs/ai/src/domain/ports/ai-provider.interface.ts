import { Message } from '../entities/conversation.entity';

export interface AiProvider {
  chat(messages: Message[]): Promise<string>;
}
