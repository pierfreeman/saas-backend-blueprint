import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class LangChainClient implements OnModuleInit {
  private readonly logger = new Logger(LangChainClient.name);

  constructor(private readonly configService: ConfigService) {}

  onModuleInit(): void {
    // TODO: Initialize LangChain model (Anthropic / Google / OpenAI)
    this.logger.log('LangChain client initialized');
  }
}
