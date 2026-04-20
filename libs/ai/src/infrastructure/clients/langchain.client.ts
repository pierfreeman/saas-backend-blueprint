import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AzureChatOpenAI } from '@langchain/openai';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';

@Injectable()
export class LangChainClient implements OnModuleInit {
  private readonly logger = new Logger(LangChainClient.name);
  private model: AzureChatOpenAI | undefined;

  constructor(private readonly configService: ConfigService) {}

  onModuleInit(): void {
    const apiKey = this.configService.get<string>('ai.azureOpenaiApiKey');
    const endpoint = this.configService.get<string>('ai.azureOpenaiEndpoint');

    if (!apiKey || !endpoint) {
      this.logger.warn(
        'Azure OpenAI credentials not configured — AI chat will be unavailable',
      );
      return;
    }

    this.model = new AzureChatOpenAI({
      azureOpenAIApiKey: apiKey,
      azureOpenAIEndpoint: endpoint,
      azureOpenAIApiDeploymentName: 'gpt-4o-global',
      azureOpenAIApiVersion: '2024-12-01-preview',
      temperature: 0.7,
      streaming: true,
    });

    this.logger.log('AzureChatOpenAI client initialized (gpt-4o-global)');
  }

  async *streamChat(
    systemPrompt: string,
    userMessage: string,
  ): AsyncGenerator<string> {
    if (!this.model) {
      throw new Error('AI chat is not available — Azure OpenAI is not configured');
    }

    const messages = [
      new SystemMessage(systemPrompt),
      new HumanMessage(userMessage),
    ];

    const stream = await this.model.stream(messages);

    for await (const chunk of stream) {
      const text =
        typeof chunk.content === 'string' ? chunk.content : '';
      if (text) {
        yield text;
      }
    }
  }
}
