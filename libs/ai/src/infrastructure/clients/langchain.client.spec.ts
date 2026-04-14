import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { LangChainClient } from './langchain.client';

vi.mock('@langchain/openai', () => {
  return {
    ChatOpenAI: vi.fn().mockImplementation(() => ({
      stream: vi.fn().mockResolvedValue(
        (async function* () {
          yield { content: 'Hello' };
          yield { content: ' world' };
        })(),
      ),
    })),
  };
});

describe('LangChainClient', () => {
  let client: LangChainClient;

  const mockConfigService = {
    get: vi.fn((key: string) => {
      const config: Record<string, string> = {
        'ai.azureOpenaiApiKey': 'test-key',
        'ai.azureOpenaiEndpoint': 'https://test.openai.azure.com/openai/v1/',
      };
      return config[key];
    }),
  };

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        LangChainClient,
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    client = module.get(LangChainClient);
    client.onModuleInit();
  });

  it('should be defined', () => {
    expect(client).toBeDefined();
  });

  it('should yield streamed text chunks', async () => {
    const chunks: string[] = [];

    for await (const chunk of client.streamChat('You are helpful.', 'Hi')) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual(['Hello', ' world']);
  });
});
