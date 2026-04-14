import { Module } from '@nestjs/common';
import { PrismaBusinessModule } from '@libs/prisma-business';
import { ActivityLogModule } from '@libs/activity-log';
import { LegalAuditModule } from '@libs/legal-audit';

// Infrastructure
import { LangChainClient } from './infrastructure/clients/langchain.client';
import { AiConversationRepository } from './infrastructure/repositories/ai-conversation.repository';

// Application
import { AiChatService } from './application/services/ai-chat.service';

@Module({
  imports: [PrismaBusinessModule, ActivityLogModule, LegalAuditModule],
  providers: [
    // Infrastructure
    LangChainClient,
    AiConversationRepository,

    // Application
    AiChatService,
  ],
  exports: [AiChatService],
})
export class AiModule {}
