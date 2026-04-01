import {
  Controller,
  createParamDecorator,
  Delete,
  ExecutionContext,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  Param,
  ParseUUIDPipe,
  Body,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentTenant, JwtAuthGuard } from '@libs/common';
import { NotificationsService } from '@libs/notifications';
import { OrgContextGuard, RBACGuard } from '@libs/rbac';
import { MarkManyReadDto } from './dto/mark-many-read.dto';
import { QueryNotificationsDto } from './dto/query-notifications.dto';

/**
 * Extracts the resolved DB user UUID from request.user.dbUserId,
 * set by OrgContextGuard after JWT sub → DB user resolution.
 */
const CurrentDbUserId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string | undefined => {
    const request = ctx
      .switchToHttp()
      .getRequest<{ user?: { dbUserId?: string } }>();
    return request.user?.dbUserId;
  },
);

/**
 * NotificationsController
 *
 * REST API for reading and managing in-app notifications.
 * All endpoints require a valid JWT bearer token.
 *
 * Notifications are created internally by application services — there is no
 * public HTTP endpoint to create them. Clients can only list, mark as read,
 * and delete their own notifications.
 *
 * Org-scoped endpoints (GET /notifications) read the orgId from the query
 * parameter. User-scoped endpoints (PATCH, DELETE, GET /unread-count) are
 * scoped only to the authenticated user — no org context is required.
 */
@ApiTags('Notifications')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, OrgContextGuard, RBACGuard)
@Controller('notifications')
export class NotificationsController {
  private readonly logger = new Logger(NotificationsController.name);

  constructor(private readonly notificationsService: NotificationsService) {}

  // ── GET /notifications ───────────────────────────────────────────────────

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
    @CurrentDbUserId() userId: string,
    @CurrentTenant('tenantId') orgId: string,
    @Query() query: QueryNotificationsDto,
  ) {
    return this.notificationsService.getUserNotifications(userId, orgId, {
      limit: query.limit,
      offset: query.offset,
      unreadOnly: query.unreadOnly,
    });
  }

  // ── GET /notifications/unread-count ──────────────────────────────────────

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
  async getUnreadCount(@CurrentDbUserId() userId: string) {
    const count = await this.notificationsService.getUnreadCount(userId);
    return { count };
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
    @CurrentDbUserId() userId: string,
  ) {
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
    @CurrentDbUserId() userId: string,
  ): Promise<void> {
    await this.notificationsService.markManyAsRead(dto.ids, userId);
  }

  // ── DELETE /notifications/:id ──────────────────────────────────────────────

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
    @CurrentDbUserId() userId: string,
  ): Promise<void> {
    await this.notificationsService.deleteNotification(id, userId);
  }
}
