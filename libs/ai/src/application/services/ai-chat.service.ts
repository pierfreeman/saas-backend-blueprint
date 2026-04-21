import { Injectable } from '@nestjs/common';
import { PlanningService } from '@libs/planning';
import { LangChainClient } from '../../infrastructure/clients/langchain.client';
import { createReadCalendarTool } from '../../infrastructure/tools/read/read-calendar.tool';
import { createWriteCalendarTool } from '../../infrastructure/tools/write/write-calendar.tool';

const BASE_SYSTEM_PROMPT =
  'You are a helpful assistant. Answer clearly and concisely.';

@Injectable()
export class AiChatService {
  constructor(
    private readonly langchainClient: LangChainClient,
    private readonly planningService: PlanningService,
  ) {}

  async *streamChat(message: string, orgId: string, userId: string): AsyncGenerator<string> {
    const tools = [
      createReadCalendarTool(this.planningService, orgId),
      createWriteCalendarTool(this.planningService, orgId, userId),
    ];
    const systemPrompt = `${BASE_SYSTEM_PROMPT}\nToday's date is ${new Date().toISOString()}.`;

    yield* this.langchainClient.streamChat(systemPrompt, message, tools);
  }
}
