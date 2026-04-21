import { Test } from '@nestjs/testing';
import { AiChatService } from './ai-chat.service';
import { LangChainClient } from '../../infrastructure/clients/langchain.client';
import { PlanningService } from '@libs/planning';

describe('AiChatService', () => {
  let service: AiChatService;

  const mockLangChainClient = {
    streamChat: vi.fn(),
  };

  const mockPlanningService = {
    listEvents: vi.fn(),
  };

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        AiChatService,
        { provide: LangChainClient, useValue: mockLangChainClient },
        { provide: PlanningService, useValue: mockPlanningService },
      ],
    }).compile();

    service = module.get(AiChatService);
    vi.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should delegate to langchain client with tools and yield chunks', async () => {
    mockLangChainClient.streamChat.mockReturnValue(
      (async function* () {
        yield 'Hello';
        yield ' there';
      })(),
    );

    const chunks: string[] = [];
    for await (const chunk of service.streamChat('Hi', 'org-1')) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual(['Hello', ' there']);
    expect(mockLangChainClient.streamChat).toHaveBeenCalledWith(
      expect.any(String),
      'Hi',
      expect.arrayContaining([
        expect.objectContaining({ name: 'list_calendar_events' }),
      ]),
    );
  });
});
