import { Test } from '@nestjs/testing';
import { PrismaBusinessService } from '@libs/prisma-business';
import { AiConversationRepository } from './ai-conversation.repository';

describe('AiConversationRepository', () => {
  let repository: AiConversationRepository;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        AiConversationRepository,
        { provide: PrismaBusinessService, useValue: {} },
      ],
    }).compile();

    repository = module.get(AiConversationRepository);
  });

  it('should be defined', () => {
    expect(repository).toBeDefined();
  });
});
