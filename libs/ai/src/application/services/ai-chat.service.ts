import { Injectable } from '@nestjs/common';
import { LangChainClient } from '../../infrastructure/clients/langchain.client';

const DEFAULT_SYSTEM_PROMPT =
  'You are a helpful assistant. Answer clearly and concisely.';

@Injectable()
export class AiChatService {
  constructor(private readonly langchainClient: LangChainClient) {}

  async *streamChat(
    orgId: string,
    userId: string,
    message: string,
  ): AsyncGenerator<string> {
    yield* this.langchainClient.streamChat(DEFAULT_SYSTEM_PROMPT, message);
  }
}
