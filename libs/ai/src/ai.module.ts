import { Module } from '@nestjs/common';
import { PlanningModule } from '@libs/planning';

import { LangChainClient } from './infrastructure/clients/langchain.client';
import { AiChatService } from './application/services/ai-chat.service';

@Module({
  imports: [PlanningModule],
  providers: [LangChainClient, AiChatService],
  exports: [AiChatService],
})
export class AiModule {}
