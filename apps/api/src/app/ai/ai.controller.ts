import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { AiChatService } from '@libs/ai';
import { JwtAuthGuard } from '@libs/common';
import { OrgContextGuard, RBACGuard, OrgScoped } from '@libs/rbac';
import { ChatRequestDto } from './dto/chat-request.dto';
import { ChatResponseDto } from './dto/chat-response.dto';

@ApiTags('AI')
@ApiBearerAuth()
@Controller('organizations/:orgId/ai')
@UseGuards(JwtAuthGuard, OrgContextGuard, RBACGuard)
@OrgScoped()
export class AiController {
  constructor(private readonly aiChatService: AiChatService) {}

  // TODO: Implement POST /chat endpoint
}
