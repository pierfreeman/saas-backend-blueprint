import { Test } from '@nestjs/testing';
import { AiChatService } from './ai-chat.service';
import { LangChainClient } from '../../infrastructure/clients/langchain.client';
import { AiConversationRepository } from '../../infrastructure/repositories/ai-conversation.repository';

describe('AiChatService', () => {
  let service: AiChatService;

  const mockLangChainClient = {};
  const mockConversationRepository = {};

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        AiChatService,
        { provide: LangChainClient, useValue: mockLangChainClient },
        { provide: AiConversationRepository, useValue: mockConversationRepository },
      ],
    }).compile();

    service = module.get(AiChatService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
