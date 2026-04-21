import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { LangChainClient } from './langchain.client';

const mockStream = vi.fn();
const mockBindTools = vi.fn();

vi.mock('@langchain/openai', () => {
  return {
    AzureChatOpenAI: class MockAzureChatOpenAI {
      stream = mockStream;
      bindTools = mockBindTools;
    },
  };
});

interface MockChunk {
  content: string | unknown[];
  tool_calls: unknown[];
  concat(other: MockChunk): MockChunk;
}

function createChunk(content: string | unknown[], toolCalls?: unknown[]): MockChunk {
  return {
    content,
    tool_calls: toolCalls ?? [],
    concat(other: MockChunk) {
      const mergedContent =
        typeof this.content === 'string' && typeof other.content === 'string'
          ? this.content + other.content
          : other.content;
      const mergedToolCalls = [
        ...(this.tool_calls ?? []),
        ...(other.tool_calls ?? []),
      ];
      return createChunk(mergedContent, mergedToolCalls);
    },
  };
}

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

    mockStream.mockReset();
    mockBindTools.mockReset();
  });

  it('should be defined', () => {
    expect(client).toBeDefined();
  });

  it('should yield streamed text chunks', async () => {
    mockStream.mockResolvedValue(
      (async function* () {
        yield createChunk('Hello');
        yield createChunk(' world');
      })(),
    );

    const chunks: string[] = [];
    for await (const chunk of client.streamChat('You are helpful.', 'Hi')) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual(['Hello', ' world']);
  });

  it('should skip chunks with non-string content', async () => {
    mockStream.mockResolvedValue(
      (async function* () {
        yield createChunk(['array-content']);
        yield createChunk('valid');
        yield createChunk('');
      })(),
    );

    const chunks: string[] = [];
    for await (const chunk of client.streamChat('You are helpful.', 'Hi')) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual(['valid']);
  });

  it('should execute tool calls and stream follow-up response', async () => {
    const mockTool = {
      name: 'list_calendar_events',
      invoke: vi.fn().mockResolvedValue('["event1"]'),
    };

    const boundStream = vi.fn();
    mockBindTools.mockReturnValue({ stream: boundStream });

    // First call: LLM requests a tool call (no text content)
    boundStream.mockResolvedValueOnce(
      (async function* () {
        yield createChunk('', [
          { id: 'call-1', name: 'list_calendar_events', args: { from: '2025-01-01', to: '2025-01-31' } },
        ]);
      })(),
    );

    // Second call: follow-up after tool result
    boundStream.mockResolvedValueOnce(
      (async function* () {
        yield createChunk('You have 1 event.');
      })(),
    );

    const chunks: string[] = [];
    for await (const chunk of client.streamChat(
      'You are helpful.',
      'What is on my calendar?',
      [mockTool as never],
    )) {
      chunks.push(chunk);
    }

    expect(mockTool.invoke).toHaveBeenCalledWith({ from: '2025-01-01', to: '2025-01-31' });
    expect(chunks).toEqual(['You have 1 event.']);
  });
});
