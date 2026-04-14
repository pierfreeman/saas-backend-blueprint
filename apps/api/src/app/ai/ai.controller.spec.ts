import { Test } from '@nestjs/testing';
import { AiController } from './ai.controller';
import { AiChatService } from '@libs/ai';

describe('AiController', () => {
  let controller: AiController;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      controllers: [AiController],
      providers: [{ provide: AiChatService, useValue: {} }],
    }).compile();

    controller = module.get(AiController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
