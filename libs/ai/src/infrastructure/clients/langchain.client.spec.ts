import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { LangChainClient } from './langchain.client';

describe('LangChainClient', () => {
  let client: LangChainClient;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        LangChainClient,
        { provide: ConfigService, useValue: { get: vi.fn() } },
      ],
    }).compile();

    client = module.get(LangChainClient);
  });

  it('should be defined', () => {
    expect(client).toBeDefined();
  });
});
