import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
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
import { JwtAuthGuard, PERMISSIONS } from '@libs/common';
import {
  CurrentUserId,
  OrgContextGuard,
  OrgScoped,
  RBACGuard,
  RequirePermissions,
} from '@libs/rbac';
import { Membership } from '@prisma/client';
import { PlanningService } from '@libs/planning';
import { CreateEventDto } from './dto/create-event.dto';
import { UpdateEventDto } from './dto/update-event.dto';
import { QueryEventsDto, MAX_RANGE_DAYS } from './dto/query-events.dto';
import { RsvpEventDto } from './dto/rsvp-event.dto';
import { CreateExceptionDto } from './dto/create-exception.dto';

interface OrgRequest extends Request {
  membership: Membership;
}

@ApiTags('Planning')
@ApiBearerAuth()
@OrgScoped()
@UseGuards(JwtAuthGuard, OrgContextGuard, RBACGuard)
@Controller('organizations/:orgId/planning/events')
export class PlanningController {
  constructor(private readonly planningService: PlanningService) {}

  // ── Create ─────────────────────────────────────────────────────────────────

  @Post()
  @RequirePermissions([PERMISSIONS.PLANNING_MANAGE])
  @ApiOperation({
    summary: 'Create a planning event',
    description:
      'Creates a single or recurring event within the organisation. ' +
      'The authenticated user is added as an attendee with RSVP=YES. ' +
      'All other attendeeIds receive an in-app invite notification.',
  })
  @ApiParam({ name: 'orgId', description: 'Organisation UUID' })
  @ApiResponse({ status: HttpStatus.CREATED, description: 'Event created.' })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Validation error or invalid RRULE.',
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'Missing or invalid JWT.',
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description: 'Insufficient permissions.',
  })
  async create(
    @Param('orgId') orgId: string,
    @Body() dto: CreateEventDto,
    @CurrentUserId() actorUserId: string,
  ) {
    return this.planningService.createEvent(orgId, actorUserId, {
      title: dto.title,
      description: dto.description,
      location: dto.location,
      start: dto.start,
      end: dto.end,
      isAllDay: dto.isAllDay,
      eventTimezone: dto.eventTimezone,
      rrule: dto.rrule,
      rruleUntilUtc: dto.rruleUntilUtc,
      attendeeIds: dto.attendeeIds,
    });
  }

  // ── List (range query with RRULE expansion) ─────────────────────────────────

  @Get()
  @RequirePermissions([PERMISSIONS.ORG_READ])
  @ApiOperation({
    summary: 'List events for a date range',
    description:
      'Returns expanded occurrences (including RRULE-generated ones) that fall within ' +
      '[from, to]. Cancelled occurrences and soft-deleted events are excluded. ' +
      'Max range: 365 days. Max occurrences: 500.',
  })
  @ApiParam({ name: 'orgId', description: 'Organisation UUID' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Array of event occurrences sorted by startUtc.',
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid date range or range exceeds 365 days.',
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description: 'Insufficient permissions.',
  })
  async list(@Param('orgId') orgId: string, @Query() query: QueryEventsDto) {
    const from = new Date(query.from);
    const to = new Date(query.to);

    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      throw new BadRequestException('from and to must be valid ISO 8601 dates');
    }
    if (to <= from) {
      throw new BadRequestException('to must be after from');
    }

    const rangeDays = (to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24);
    if (rangeDays > MAX_RANGE_DAYS) {
      throw new BadRequestException(
        `Date range must not exceed ${MAX_RANGE_DAYS} days`,
      );
    }

    return this.planningService.listEvents(orgId, from, to);
  }

  // ── Get detail ─────────────────────────────────────────────────────────────

  @Get(':id')
  @RequirePermissions([PERMISSIONS.ORG_READ])
  @ApiOperation({
    summary: 'Get event detail',
    description:
      'Returns the master event record with all attendees and exceptions.',
  })
  @ApiParam({ name: 'orgId', description: 'Organisation UUID' })
  @ApiParam({ name: 'id', description: 'Event UUID' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Event detail.' })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Event not found.',
  })
  async findOne(
    @Param('orgId') orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.planningService.getEvent(orgId, id);
  }

  // ── Update ─────────────────────────────────────────────────────────────────

  @Patch(':id')
  @RequirePermissions([PERMISSIONS.PLANNING_MANAGE])
  @ApiOperation({
    summary: 'Update an event',
    description:
      'Partially updates a planning event. The `version` field (optimistic-concurrency lock) ' +
      'is required and must match the current value — 409 is returned if stale. ' +
      'MEMBER-role callers may only update events they created; ADMIN/OWNER can update any.',
  })
  @ApiParam({ name: 'orgId', description: 'Organisation UUID' })
  @ApiParam({ name: 'id', description: 'Event UUID' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Updated event.' })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Validation error.',
  })
  @ApiResponse({
    status: HttpStatus.CONFLICT,
    description: 'Stale version — event was modified by another request.',
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description: 'Actor is not the creator and lacks ADMIN role.',
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Event not found.',
  })
  async update(
    @Param('orgId') orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateEventDto,
    @CurrentUserId() actorUserId: string,
    @Req() req: OrgRequest,
  ) {
    return this.planningService.updateEvent(
      orgId,
      id,
      dto,
      actorUserId,
      req.membership.role,
    );
  }

  // ── Delete ─────────────────────────────────────────────────────────────────

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions([PERMISSIONS.PLANNING_MANAGE])
  @ApiOperation({
    summary: 'Delete an event',
    description:
      'Soft-deletes the event. The record is retained in the database but excluded from ' +
      'all queries. MEMBER-role callers may only delete events they created.',
  })
  @ApiParam({ name: 'orgId', description: 'Organisation UUID' })
  @ApiParam({ name: 'id', description: 'Event UUID' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Event deleted.' })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Event not found.',
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description: 'Actor is not the creator and lacks ADMIN role.',
  })
  async remove(
    @Param('orgId') orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUserId() actorUserId: string,
    @Req() req: OrgRequest,
  ): Promise<{ message: string }> {
    await this.planningService.deleteEvent(
      orgId,
      id,
      actorUserId,
      req.membership.role,
    );
    return { message: 'Event deleted successfully' };
  }

  // ── RSVP ───────────────────────────────────────────────────────────────────

  @Post(':id/rsvp')
  @RequirePermissions([PERMISSIONS.ORG_READ])
  @ApiOperation({
    summary: 'RSVP to an event',
    description:
      'Creates or updates the RSVP status for the authenticated user. ' +
      'All org members can RSVP regardless of whether they were explicitly invited. ' +
      'The event creator receives an in-app notification when another member RSVPs.',
  })
  @ApiParam({ name: 'orgId', description: 'Organisation UUID' })
  @ApiParam({ name: 'id', description: 'Event UUID' })
  @ApiResponse({ status: HttpStatus.CREATED, description: 'RSVP recorded.' })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Event not found.',
  })
  async rsvp(
    @Param('orgId') orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RsvpEventDto,
    @CurrentUserId() actorUserId: string,
  ) {
    return this.planningService.rsvp(orgId, id, actorUserId, dto.status);
  }

  // ── Exceptions ─────────────────────────────────────────────────────────────

  @Post(':id/exceptions')
  @RequirePermissions([PERMISSIONS.PLANNING_MANAGE])
  @ApiOperation({
    summary: 'Create or update an occurrence exception',
    description:
      'Persists an override or cancellation for a specific occurrence of a recurring event. ' +
      'The occurrence is identified by `originalStartUtc` (the RRULE-computed start time). ' +
      'Set `isCancelled: true` to exclude the occurrence from future range queries (EXDATE). ' +
      'Upserts: calling again with the same `originalStartUtc` updates the existing exception.',
  })
  @ApiParam({ name: 'orgId', description: 'Organisation UUID' })
  @ApiParam({ name: 'id', description: 'Event UUID (recurring master)' })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'Exception created or updated.',
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Event is not recurring.',
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Event not found.',
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description: 'Actor is not the creator and lacks ADMIN role.',
  })
  async createException(
    @Param('orgId') orgId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateExceptionDto,
    @CurrentUserId() actorUserId: string,
    @Req() req: OrgRequest,
  ) {
    return this.planningService.createException(
      orgId,
      id,
      dto,
      actorUserId,
      req.membership.role,
    );
  }
}
