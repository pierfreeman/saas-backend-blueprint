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

  it('should handle unknown tool requested by LLM', async () => {
    const mockTool = {
      name: 'list_calendar_events',
      invoke: vi.fn(),
    };

    const boundStream = vi.fn();
    mockBindTools.mockReturnValue({ stream: boundStream });

    boundStream.mockResolvedValueOnce(
      (async function* () {
        yield createChunk('', [
          { id: 'call-1', name: 'unknown_tool', args: {} },
        ]);
      })(),
    );

    boundStream.mockResolvedValueOnce(
      (async function* () {
        yield createChunk('Sorry, I could not do that.');
      })(),
    );

    const chunks: string[] = [];
    for await (const chunk of client.streamChat(
      'You are helpful.',
      'Do something',
      [mockTool as never],
    )) {
      chunks.push(chunk);
    }

    expect(mockTool.invoke).not.toHaveBeenCalled();
    expect(chunks).toEqual(['Sorry, I could not do that.']);
  });

  it('should handle tool execution failure', async () => {
    const mockTool = {
      name: 'list_calendar_events',
      invoke: vi.fn().mockRejectedValue(new Error('DB connection lost')),
    };

    const boundStream = vi.fn();
    mockBindTools.mockReturnValue({ stream: boundStream });

    boundStream.mockResolvedValueOnce(
      (async function* () {
        yield createChunk('', [
          { id: 'call-1', name: 'list_calendar_events', args: { from: '2025-01-01', to: '2025-01-31' } },
        ]);
      })(),
    );

    boundStream.mockResolvedValueOnce(
      (async function* () {
        yield createChunk('Something went wrong fetching events.');
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

    expect(mockTool.invoke).toHaveBeenCalled();
    expect(chunks).toEqual(['Something went wrong fetching events.']);
  });

  it('should handle tool execution failure with non-Error thrown value', async () => {
    const mockTool = {
      name: 'list_calendar_events',
      invoke: vi.fn().mockRejectedValue('string error'),
    };

    const boundStream = vi.fn();
    mockBindTools.mockReturnValue({ stream: boundStream });

    boundStream.mockResolvedValueOnce(
      (async function* () {
        yield createChunk('', [
          { id: 'call-1', name: 'list_calendar_events', args: {} },
        ]);
      })(),
    );

    boundStream.mockResolvedValueOnce(
      (async function* () {
        yield createChunk('Tool failed.');
      })(),
    );

    const chunks: string[] = [];
    for await (const chunk of client.streamChat(
      'You are helpful.',
      'Check calendar',
      [mockTool as never],
    )) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual(['Tool failed.']);
  });

  it('should use toolCall.name as fallback when toolCall.id is undefined', async () => {
    const mockTool = {
      name: 'list_calendar_events',
      invoke: vi.fn().mockResolvedValue('[]'),
    };

    const boundStream = vi.fn();
    mockBindTools.mockReturnValue({ stream: boundStream });

    boundStream.mockResolvedValueOnce(
      (async function* () {
        yield createChunk('', [
          { name: 'list_calendar_events', args: {} },
        ]);
      })(),
    );

    boundStream.mockResolvedValueOnce(
      (async function* () {
        yield createChunk('No events found.');
      })(),
    );

    const chunks: string[] = [];
    for await (const chunk of client.streamChat(
      'You are helpful.',
      'Any events?',
      [mockTool as never],
    )) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual(['No events found.']);
  });

  it('should throw when model is not configured', async () => {
    const unconfiguredConfigService = {
      get: vi.fn().mockReturnValue(undefined),
    };

    const module = await Test.createTestingModule({
      providers: [
        LangChainClient,
        { provide: ConfigService, useValue: unconfiguredConfigService },
      ],
    }).compile();

    const unconfiguredClient = module.get(LangChainClient);
    unconfiguredClient.onModuleInit();

    const gen = unconfiguredClient.streamChat('prompt', 'message');
    await expect(gen.next()).rejects.toThrow('AI chat is not available');
  });

  it('should return early when stream yields no chunks', async () => {
    mockStream.mockResolvedValue(
      (async function* () {
        // empty stream
      })(),
    );

    const chunks: string[] = [];
    for await (const chunk of client.streamChat('You are helpful.', 'Hi')) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual([]);
  });
});
