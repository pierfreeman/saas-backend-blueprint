import { Test } from '@nestjs/testing';
import { AiController } from './ai.controller';
import { AiChatService } from '@libs/ai';

describe('AiController', () => {
  let controller: AiController;

  const mockAiChatService = {
    streamChat: vi.fn(),
  };

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      controllers: [AiController],
      providers: [{ provide: AiChatService, useValue: mockAiChatService }],
    }).compile();

    controller = module.get(AiController);
    vi.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should stream SSE chunks and end with [DONE]', async () => {
    mockAiChatService.streamChat.mockReturnValue(
      (async function* () {
        yield 'Hello';
        yield ' world';
      })(),
    );

    const written: string[] = [];
    const mockRes = {
      setHeader: vi.fn(),
      flushHeaders: vi.fn(),
      write: vi.fn((data: string) => written.push(data)),
      end: vi.fn(),
    };

    await controller.chat(
      'org-1',
      { message: 'Hi' },
      { sub: 'user-1', email: 'test@test.com' },
      mockRes as never,
    );

    expect(written).toEqual([
      `data: ${JSON.stringify({ content: 'Hello' })}\n\n`,
      `data: ${JSON.stringify({ content: ' world' })}\n\n`,
      `data: [DONE]\n\n`,
    ]);
    expect(mockRes.end).toHaveBeenCalled();
  });
});
