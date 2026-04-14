import { Module } from '@nestjs/common';

// Infrastructure
import { LangChainClient } from './infrastructure/clients/langchain.client';

// Application
import { AiChatService } from './application/services/ai-chat.service';

@Module({
  providers: [LangChainClient, AiChatService],
  exports: [AiChatService],
})
export class AiModule {}
