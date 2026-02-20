import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import {
  CreateNotificationDto,
  GetNotificationsDto,
  MarkAsReadDto,
  NotificationResponseDto,
} from '../dto';
import { NotificationsService } from '../services/notifications.service';

@ApiTags('Notifications')
@ApiBearerAuth('JWT-auth')
@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  async getNotifications(
    @Request() req: any,
    @Query() query: GetNotificationsDto,
  ): Promise<NotificationResponseDto[]> {
    return this.notificationsService.getUserNotifications(req.user.sub, query);
  }

  @Get('unread-count')
  async getUnreadCount(@Request() req: any): Promise<{ count: number }> {
    const count = await this.notificationsService.getUnreadCount(req.user.sub);
    return { count };
  }

  @Post()
  async createNotification(
    @Request() req: any,
    @Body() dto: CreateNotificationDto,
  ): Promise<NotificationResponseDto> {
    return this.notificationsService.createNotification(req.user.sub, dto);
  }

  @Patch(':id/read')
  async markAsRead(
    @Request() req: any,
    @Param('id') notificationId: string,
  ): Promise<NotificationResponseDto> {
    return this.notificationsService.markAsRead(req.user.sub, notificationId);
  }

  @Patch('read')
  @HttpCode(HttpStatus.OK)
  async markManyAsRead(
    @Request() req: any,
    @Body() dto: MarkAsReadDto,
  ): Promise<{ count: number }> {
    if (dto.notificationIds && dto.notificationIds.length > 0) {
      const count = await this.notificationsService.markManyAsRead(
        req.user.sub,
        dto.notificationIds,
      );
      return { count };
    } else {
      const count = await this.notificationsService.markAllAsRead(req.user.sub);
      return { count };
    }
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteNotification(
    @Request() req: any,
    @Param('id') notificationId: string,
  ): Promise<void> {
    await this.notificationsService.deleteNotification(req.user.sub, notificationId);
  }
}
