import { Test } from '@nestjs/testing';
import { AiChatService } from './ai-chat.service';
import { LangChainClient } from '../../infrastructure/clients/langchain.client';

describe('AiChatService', () => {
  let service: AiChatService;

  const mockLangChainClient = {
    streamChat: vi.fn(),
  };

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        AiChatService,
        { provide: LangChainClient, useValue: mockLangChainClient },
      ],
    }).compile();

    service = module.get(AiChatService);
    vi.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should delegate to langchain client and yield chunks', async () => {
    mockLangChainClient.streamChat.mockReturnValue(
      (async function* () {
        yield 'Hello';
        yield ' there';
      })(),
    );

    const chunks: string[] = [];
    for await (const chunk of service.streamChat('Hi')) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual(['Hello', ' there']);
    expect(mockLangChainClient.streamChat).toHaveBeenCalledWith(
      expect.any(String),
      'Hi',
    );
  });
});
