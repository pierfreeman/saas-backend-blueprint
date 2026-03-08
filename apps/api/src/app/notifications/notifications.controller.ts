import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard, RequestUser } from '@libs/common';
import { NotificationsService } from '@libs/notifications';
import { AuthService } from '../auth/auth.service';
import { CreateNotificationDto } from './dto/create-notification.dto';
import { MarkManyReadDto } from './dto/mark-many-read.dto';
import { QueryNotificationsDto } from './dto/query-notifications.dto';

interface AuthenticatedRequest extends Request {
  user: RequestUser;
}

/**
 * NotificationsController
 *
 * REST fallback API for in-app notifications.
 * All endpoints require a valid JWT bearer token.
 *
 * The primary delivery path for new notifications is WebSocket (`/notifications`
 * namespace). These HTTP endpoints are provided for:
 *   - Initial page load (fetch notification history without WebSocket).
 *   - Mobile / non-persistent clients that cannot maintain a WebSocket.
 *   - Administrative tooling.
 */
@ApiTags('Notifications')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('notifications')
export class NotificationsController {
  private readonly logger = new Logger(NotificationsController.name);

  constructor(
    private readonly notificationsService: NotificationsService,
    private readonly authService: AuthService,
  ) {}

  // ── GET /notifications ────────────────────────────────────────────────────

  @Get()
  @ApiOperation({ summary: 'List notifications for the authenticated user' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Paginated notification list.',
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'Missing or invalid JWT bearer token.',
  })
  async getNotifications(
    @Req() req: AuthenticatedRequest,
    @Query() query: QueryNotificationsDto,
  ) {
    const { id: userId } = await this.resolveUser(req.user.sub);
    return this.notificationsService.getUserNotifications(
      userId,
      query.orgId ?? '',
      {
        limit: query.limit,
        offset: query.offset,
        unreadOnly: query.unreadOnly,
      },
    );
  }

  // ── GET /notifications/unread-count ───────────────────────────────────────

  @Get('unread-count')
  @ApiOperation({
    summary: 'Get unread notification count for the authenticated user',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Unread count.',
    schema: { properties: { count: { type: 'number' } } },
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'Missing or invalid JWT bearer token.',
  })
  async getUnreadCount(@Req() req: AuthenticatedRequest) {
    const { id: userId } = await this.resolveUser(req.user.sub);
    const count = await this.notificationsService.getUnreadCount(userId);
    return { count };
  }

  // ── POST /notifications ───────────────────────────────────────────────────

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a notification (internal / admin use)' })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'Notification created.',
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Validation failed — missing or invalid request body fields.',
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'Missing or invalid JWT bearer token.',
  })
  async createNotification(@Body() dto: CreateNotificationDto) {
    return this.notificationsService.createNotification({
      orgId: dto.orgId,
      userId: dto.userId,
      type: dto.type,
      title: dto.title,
      body: dto.body,
      metadata: dto.metadata,
    });
  }

  // ── PATCH /notifications/:id/read ─────────────────────────────────────────

  @Patch(':id/read')
  @ApiOperation({ summary: 'Mark a single notification as read' })
  @ApiParam({
    name: 'id',
    description: 'Notification UUID',
    type: 'string',
    format: 'uuid',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Notification marked as read.',
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'Missing or invalid JWT bearer token.',
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Notification not found or does not belong to the caller.',
  })
  async markAsRead(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthenticatedRequest,
  ) {
    const { id: userId } = await this.resolveUser(req.user.sub);
    return this.notificationsService.markAsRead(id, userId);
  }

  // ── PATCH /notifications/read ─────────────────────────────────────────────

  @Patch('read')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Mark multiple notifications as read' })
  @ApiResponse({
    status: HttpStatus.NO_CONTENT,
    description: 'Notifications marked as read.',
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Validation failed — ids must be an array of UUIDs.',
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'Missing or invalid JWT bearer token.',
  })
  async markManyAsRead(
    @Body() dto: MarkManyReadDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<void> {
    const { id: userId } = await this.resolveUser(req.user.sub);
    await this.notificationsService.markManyAsRead(dto.ids, userId);
  }

  // ── DELETE /notifications/:id ─────────────────────────────────────────────

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a notification' })
  @ApiParam({
    name: 'id',
    description: 'Notification UUID',
    type: 'string',
    format: 'uuid',
  })
  @ApiResponse({
    status: HttpStatus.NO_CONTENT,
    description: 'Notification deleted.',
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'Missing or invalid JWT bearer token.',
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Notification not found or does not belong to the caller.',
  })
  async deleteNotification(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<void> {
    const { id: userId } = await this.resolveUser(req.user.sub);
    await this.notificationsService.deleteNotification(id, userId);
  }

  /** Resolves Auth0 sub → local DB user (mirrors organisations.controller pattern). */
  private async resolveUser(auth0Id: string): Promise<{ id: string }> {
    const user = await this.authService.findUserByAuth0Id(auth0Id);
    if (!user) throw new NotFoundException('User not found');
    return user;
  }
}
