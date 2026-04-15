import {
  Controller,
  Post,
  Body,
  Param,
  UseGuards,
  Res,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { AiChatService } from '@libs/ai';
import { JwtAuthGuard, RequestUser } from '@libs/common';
import { OrgContextGuard, RBACGuard, OrgScoped } from '@libs/rbac';
import { CurrentUser } from '../auth/current-user.decorator';
import { ChatRequestDto } from './dto/chat-request.dto';
import type { Response } from 'express';

@ApiTags('AI')
@ApiBearerAuth()
@Controller('organizations/:orgId/ai')
@UseGuards(JwtAuthGuard, OrgContextGuard, RBACGuard)
@OrgScoped()
export class AiController {
  constructor(private readonly aiChatService: AiChatService) {}

  @Post('chat')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Stream a chat response from the AI' })
  async chat(
    @Param('orgId') orgId: string,
    @Body() dto: ChatRequestDto,
    @CurrentUser() user: RequestUser,
    @Res() res: Response,
  ): Promise<void> {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    try {
      for await (const chunk of this.aiChatService.streamChat(
        orgId,
        user.sub,
        dto.message,
      )) {
        res.write(`data: ${JSON.stringify({ content: chunk })}\n\n`);
      }

      res.write(`data: [DONE]\n\n`);
    } catch {
      res.write(
        `data: ${JSON.stringify({ error: 'An error occurred while generating the response' })}\n\n`,
      );
    } finally {
      res.end();
    }
  }
}
