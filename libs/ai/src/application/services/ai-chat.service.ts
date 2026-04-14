import { Injectable } from '@nestjs/common';
import { LangChainClient } from '../../infrastructure/clients/langchain.client';
import { AiConversationRepository } from '../../infrastructure/repositories/ai-conversation.repository';

@Injectable()
export class AiChatService {
  constructor(
    private readonly langchainClient: LangChainClient,
    private readonly conversationRepository: AiConversationRepository,
  ) {}

  // TODO: Implement chat orchestration
}
