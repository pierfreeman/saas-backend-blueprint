import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AzureChatOpenAI } from '@langchain/openai';
import {
  HumanMessage,
  SystemMessage,
  ToolMessage,
} from '@langchain/core/messages';
import type { BaseMessage } from '@langchain/core/messages';
import type { DynamicStructuredTool } from '@langchain/core/tools';
import type { AIMessageChunk } from '@langchain/core/messages';

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
    tools?: DynamicStructuredTool[],
  ): AsyncGenerator<string> {
    if (!this.model) {
      throw new Error(
        'AI chat is not available — Azure OpenAI is not configured',
      );
    }

    const llm =
      tools && tools.length > 0 ? this.model.bindTools(tools) : this.model;

    const messages: BaseMessage[] = [
      new SystemMessage(systemPrompt),
      new HumanMessage(userMessage),
    ];

    const stream = await llm.stream(messages);

    const chunks: AIMessageChunk[] = [];
    for await (const chunk of stream) {
      chunks.push(chunk);

      const text = typeof chunk.content === 'string' ? chunk.content : '';
      if (text) {
        yield text;
      }
    }

    if (chunks.length === 0) return;

    let fullMessage = chunks[0]!;
    for (let i = 1; i < chunks.length; i++) {
      fullMessage = fullMessage.concat(chunks[i]!);
    }

    if (
      tools &&
      tools.length > 0 &&
      fullMessage.tool_calls &&
      fullMessage.tool_calls.length > 0
    ) {
      messages.push(fullMessage);

      const toolsByName = new Map(tools.map((t) => [t.name, t]));

      for (const toolCall of fullMessage.tool_calls) {
        const tool = toolsByName.get(toolCall.name);
        if (!tool) {
          this.logger.warn(`LLM requested unknown tool: ${toolCall.name}`);
          messages.push(
            new ToolMessage({
              tool_call_id: toolCall.id ?? toolCall.name,
              content: JSON.stringify({ error: `Unknown tool: ${toolCall.name}` }),
            }),
          );
          continue;
        }

        try {
          const result = await tool.invoke(toolCall.args);
          messages.push(
            new ToolMessage({
              tool_call_id: toolCall.id ?? toolCall.name,
              content: typeof result === 'string' ? result : JSON.stringify(result),
            }),
          );
        } catch (error) {
          this.logger.error(
            `Tool ${toolCall.name} failed: ${error instanceof Error ? error.message : String(error)}`,
          );
          messages.push(
            new ToolMessage({
              tool_call_id: toolCall.id ?? toolCall.name,
              content: JSON.stringify({
                error: `Tool execution failed: ${error instanceof Error ? error.message : String(error)}`,
              }),
            }),
          );
        }
      }

      const followUpStream = await llm.stream(messages);
      for await (const chunk of followUpStream) {
        const text = typeof chunk.content === 'string' ? chunk.content : '';
        if (text) {
          yield text;
        }
      }
    }
  }
}
