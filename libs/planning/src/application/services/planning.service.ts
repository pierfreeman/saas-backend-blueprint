import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ActivityLogService } from '@libs/activity-log';
import { LegalAuditService } from '@libs/legal-audit';
import { NotificationsService } from '@libs/notifications';
import { UsersService } from '@libs/users';
import {
  Event,
  EventAttendee,
  EventException,
  MembershipRole,
  Prisma,
  RSVPStatus,
} from '@libs/prisma-business';
import {
  PlanningRepository,
  SplitSeriesParams,
  UpdateEventData,
} from '../../infrastructure/repositories/planning.repository';
import { RecurrenceService } from './recurrence.service';
import { EventOccurrence } from '../../planning.types';

export interface CreateEventInput {
  title: string;
  description?: string | null;
  location?: string | null;
  start: string;
  end: string;
  isAllDay?: boolean;
  eventTimezone: string;
  rrule?: string | null;
  rruleUntilUtc?: string | null;
  attendeeIds?: string[];
  metadata?: Prisma.InputJsonValue | null;
  reminderMinutes?: number | null;
}

export interface UpdateEventInput {
  title?: string;
  description?: string | null;
  location?: string | null;
  start?: string;
  end?: string;
  isAllDay?: boolean;
  eventTimezone?: string;
  rrule?: string | null;
  rruleUntilUtc?: string | null;
  metadata?: Prisma.InputJsonValue | null;
  version: number;
  notifyAttendees?: boolean;
  /** When provided, replaces the full invited-attendee list (creator is always kept). */
  attendeeIds?: string[];
  reminderMinutes?: number | null;
}

export interface CreateExceptionInput {
  originalStartUtc: string;
  startUtc?: string | null;
  endUtc?: string | null;
  isCancelled?: boolean;
  title?: string | null;
  description?: string | null;
  location?: string | null;
}

export interface SplitSeriesInput {
  /** The RRULE-generated UTC start of the occurrence at which to split (ISO 8601). */
  originalStartUtc: string;
  /** Optimistic-concurrency version of the original event. */
  version: number;
  /** Optional new title for the tail series. */
  title?: string;
  /** Optional new description for the tail series. */
  description?: string | null;
  /** Optional new location for the tail series. */
  location?: string | null;
  /** Optional rescheduled start for the first occurrence of the tail series (ISO 8601). */
  startUtc?: string;
  /** Optional rescheduled end for the first occurrence of the tail series (ISO 8601). */
  endUtc?: string;
}

export type EventDetail = Event & {
  attendees: EventAttendee[];
  exceptions: EventException[];
};

@Injectable()
export class PlanningService {
  private readonly logger = new Logger(PlanningService.name);

  constructor(
    private readonly repo: PlanningRepository,
    private readonly recurrenceService: RecurrenceService,
    private readonly activityLog: ActivityLogService,
    private readonly legalAudit: LegalAuditService,
    private readonly notificationsService: NotificationsService,
    private readonly usersService: UsersService,
  ) {}

  async createEvent(
    orgId: string,
    createdByUserId: string,
    dto: CreateEventInput,
  ): Promise<EventDetail> {
    this.logger.log(`Creating event "${dto.title}" in org ${orgId}`);

    if (dto.rrule && !this.recurrenceService.isValidRrule(dto.rrule)) {
      throw new BadRequestException(`Invalid RRULE string: "${dto.rrule}"`);
    }

    const startUtc = new Date(dto.start);
    const endUtc = new Date(dto.end);

    if (endUtc <= startUtc) {
      throw new BadRequestException('end must be after start');
    }

    const event = await this.repo.createEvent({
      orgId,
      createdByUserId,
      title: dto.title,
      description: dto.description,
      location: dto.location,
      startUtc,
      endUtc,
      isAllDay: dto.isAllDay ?? false,
      eventTimezone: dto.eventTimezone,
      rrule: dto.rrule,
      rruleUntilUtc: dto.rruleUntilUtc ? new Date(dto.rruleUntilUtc) : null,
      metadata: dto.metadata,
      reminderMinutes: dto.reminderMinutes ?? null,
    });

    // Creator is always YES
    await this.repo.upsertAttendee(event.id, createdByUserId, RSVPStatus.YES);

    const invitedIds = (dto.attendeeIds ?? []).filter(
      (id) => id !== createdByUserId,
    );

    for (const userId of invitedIds) {
      await this.repo.upsertAttendee(event.id, userId, RSVPStatus.PENDING);
    }

    // Notify invited attendees (fire-and-forget; errors logged internally by NotificationsService)
    if (invitedIds.length > 0) {
      this.sendInviteNotifications(
        invitedIds,
        orgId,
        event.id,
        event.title,
      ).catch((err: unknown) => {
        this.logger.error(
          `Failed to send invite notifications for event ${event.id}: ${err instanceof Error ? err.message : 'unknown error'}`,
        );
      });
    }

    this.activityLog.logActivity({
      orgId,
      actorId: createdByUserId,
      action: 'planning.event.created',
      entityType: 'event',
      entityId: event.id,
      metadata: {
        title: event.title,
        rrule: event.rrule,
        attendeeCount: invitedIds.length + 1,
      },
    });

    this.legalAudit.recordEvent({
      eventType: 'planning.event.created',
      orgId,
      userId: createdByUserId,
      triggerType: 'user',
      metadata: { eventId: event.id, title: event.title },
    });

    const attendees = await this.repo.findAttendees(event.id);
    return { ...event, attendees, exceptions: [] };
  }

  async listEvents(
    orgId: string,
    from: Date,
    to: Date,
  ): Promise<EventOccurrence[]> {
    const events = await this.repo.findEventsByRange(orgId, from, to);
    const occurrences: EventOccurrence[] = [];

    for (const event of events) {
      occurrences.push(...this.recurrenceService.expand(event, from, to));
    }

    // Sort chronologically
    occurrences.sort((a, b) => a.startUtc.getTime() - b.startUtc.getTime());

    return occurrences;
  }

  async getConflicts(
    orgId: string,
    userId: string,
    start: Date,
    end: Date,
  ): Promise<EventOccurrence[]> {
    const events = await this.repo.findConflictCandidates(
      orgId,
      userId,
      start,
      end,
    );

    const occurrences: EventOccurrence[] = [];
    for (const event of events) {
      occurrences.push(...this.recurrenceService.expand(event, start, end));
    }

    // True overlap for [start, end): excludes back-to-back events.
    return occurrences
      .filter((occ) => occ.startUtc < end && occ.endUtc > start)
      .sort((a, b) => a.startUtc.getTime() - b.startUtc.getTime());
  }

  async getEvent(orgId: string, id: string): Promise<EventDetail> {
    const event = await this.repo.findEventById(id, orgId);
    if (!event) {
      throw new NotFoundException(`Event ${id} not found`);
    }
    return event;
  }

  async updateEvent(
    orgId: string,
    id: string,
    dto: UpdateEventInput,
    actorUserId: string,
    actorRole: MembershipRole,
  ): Promise<EventDetail> {
    const event = await this.repo.findEventById(id, orgId);
    if (!event) {
      throw new NotFoundException(`Event ${id} not found`);
    }

    this.assertCanModify(event, actorUserId, actorRole);

    if (dto.rrule && !this.recurrenceService.isValidRrule(dto.rrule)) {
      throw new BadRequestException(`Invalid RRULE string: "${dto.rrule}"`);
    }

    const startUtc = dto.start ? new Date(dto.start) : undefined;
    const endUtc = dto.end ? new Date(dto.end) : undefined;

    if (startUtc && endUtc && endUtc <= startUtc) {
      throw new BadRequestException('end must be after start');
    }

    const updateData: UpdateEventData = {
      title: dto.title,
      description: dto.description,
      location: dto.location,
      startUtc,
      endUtc,
      isAllDay: dto.isAllDay,
      eventTimezone: dto.eventTimezone,
      rrule: dto.rrule,
      rruleUntilUtc: dto.rruleUntilUtc
        ? new Date(dto.rruleUntilUtc)
        : undefined,
      metadata: dto.metadata,
      reminderMinutes: dto.reminderMinutes,
    };

    // Strip undefined keys to avoid overwriting unchanged fields
    for (const key of Object.keys(updateData) as (keyof UpdateEventData)[]) {
      if (updateData[key] === undefined) {
        delete updateData[key];
      }
    }

    let updated = await this.repo.updateEvent(
      id,
      orgId,
      dto.version,
      updateData,
    );

    // Sync attendee list when attendeeIds is explicitly provided
    if (dto.attendeeIds !== undefined) {
      const newInvitedIds = dto.attendeeIds.filter(
        (uid) => uid !== actorUserId && uid !== event.createdByUserId,
      );
      // Remove attendees no longer in the list (keep creator and actor)
      const keepUserIds = [
        ...new Set([event.createdByUserId, actorUserId, ...newInvitedIds]),
      ];
      await this.repo.deleteAttendeesExcluding(id, keepUserIds);

      // Upsert newly invited attendees
      const existingIds = new Set(updated.attendees.map((a) => a.userId));
      const brandNewIds = newInvitedIds.filter((uid) => !existingIds.has(uid));
      for (const userId of brandNewIds) {
        await this.repo.upsertAttendee(id, userId, RSVPStatus.PENDING);
      }

      // Send invite notifications to newly added attendees (fire-and-forget)
      if (brandNewIds.length > 0) {
        this.sendInviteNotifications(
          brandNewIds,
          orgId,
          id,
          updated.title,
        ).catch((err: unknown) => {
          this.logger.error(
            `Failed to send invite notifications for event ${id}: ${err instanceof Error ? err.message : 'unknown error'}`,
          );
        });
      }

      // Re-fetch so the returned attendees list is accurate
      const refreshed = await this.repo.findEventById(id, orgId);
      if (!refreshed) throw new NotFoundException(`Event ${id} not found`);
      updated = refreshed;
    }

    if (dto.notifyAttendees) {
      const attendeeIds = updated.attendees
        .filter((a) => a.userId !== actorUserId)
        .map((a) => a.userId);

      if (attendeeIds.length > 0) {
        this.sendUpdateNotifications(
          attendeeIds,
          orgId,
          id,
          updated.title,
        ).catch((err: unknown) => {
          this.logger.error(
            `Failed to send update notifications for event ${id}: ${err instanceof Error ? err.message : 'unknown error'}`,
          );
        });
      }
    }

    this.activityLog.logActivity({
      orgId,
      actorId: actorUserId,
      action: 'planning.event.updated',
      entityType: 'event',
      entityId: id,
      metadata: {
        title: updated.title,
        notifyAttendees: dto.notifyAttendees ?? false,
      },
    });

    this.legalAudit.recordEvent({
      eventType: 'planning.event.updated',
      orgId,
      userId: actorUserId,
      triggerType: 'user',
      metadata: { eventId: id },
    });

    return updated;
  }

  async deleteEvent(
    orgId: string,
    id: string,
    actorUserId: string,
    actorRole: MembershipRole,
  ): Promise<void> {
    const event = await this.repo.findEventById(id, orgId);
    if (!event) {
      throw new NotFoundException(`Event ${id} not found`);
    }

    this.assertCanModify(event, actorUserId, actorRole);

    await this.repo.softDeleteEvent(id, orgId);

    // Notify all attendees (except the actor) that the event was cancelled
    const attendeeIds = event.attendees
      .map((a) => a.userId)
      .filter((uid) => uid !== actorUserId);

    if (attendeeIds.length > 0) {
      this.sendCancelNotifications(attendeeIds, orgId, id, event.title).catch(
        (err: unknown) => {
          this.logger.error(
            `Failed to send cancel notifications for event ${id}: ${err instanceof Error ? err.message : 'unknown error'}`,
          );
        },
      );
    }

    this.activityLog.logActivity({
      orgId,
      actorId: actorUserId,
      action: 'planning.event.deleted',
      entityType: 'event',
      entityId: id,
      metadata: { title: event.title },
    });

    this.legalAudit.recordEvent({
      eventType: 'planning.event.deleted',
      orgId,
      userId: actorUserId,
      triggerType: 'user',
      metadata: { eventId: id, title: event.title },
    });
  }

  async rsvp(
    orgId: string,
    eventId: string,
    actorUserId: string,
    status: RSVPStatus,
  ): Promise<EventAttendee> {
    const event = await this.repo.findEventById(eventId, orgId);
    if (!event) {
      throw new NotFoundException(`Event ${eventId} not found`);
    }

    const attendee = await this.repo.upsertAttendee(
      eventId,
      actorUserId,
      status,
    );

    // Notify creator of the RSVP (only if actor is not the creator)
    if (event.createdByUserId !== actorUserId) {
      const actorDisplayName = await this.getUserDisplayName(actorUserId);

      this.notificationsService
        .notifyUser(event.createdByUserId, orgId, {
          type: 'event.rsvp',
          title: 'RSVP updated',
          body: `${actorDisplayName} responded "${status}" to "${event.title}"`,
          metadata: {
            entityRef: { type: 'event', id: eventId },
            userId: actorUserId,
            status,
          },
        })
        .catch((err: unknown) => {
          this.logger.error(
            `Failed to send RSVP notification for event ${eventId}: ${err instanceof Error ? err.message : 'unknown error'}`,
          );
        });
    }

    return attendee;
  }

  private async getUserDisplayName(userId: string): Promise<string> {
    try {
      const user = await this.usersService.findById(userId);
      if (!user) {
        return userId;
      }

      const fullName = [user.firstName, user.lastName]
        .filter((value): value is string => Boolean(value))
        .join(' ')
        .trim();

      return fullName || user.email || userId;
    } catch (err: unknown) {
      this.logger.warn(
        `Failed to resolve display name for user ${userId}: ${err instanceof Error ? err.message : 'unknown error'}`,
      );
      return userId;
    }
  }

  async createException(
    orgId: string,
    eventId: string,
    dto: CreateExceptionInput,
    actorUserId: string,
    actorRole: MembershipRole,
  ): Promise<EventException> {
    const event = await this.repo.findEventById(eventId, orgId);
    if (!event) {
      throw new NotFoundException(`Event ${eventId} not found`);
    }
    if (!event.rrule) {
      throw new BadRequestException(
        'Cannot create exceptions for non-recurring events',
      );
    }

    this.assertCanModify(event, actorUserId, actorRole);

    const originalStartUtc = new Date(dto.originalStartUtc);

    const exception = await this.repo.upsertException({
      eventId,
      originalStartUtc,
      startUtc: dto.startUtc ? new Date(dto.startUtc) : null,
      endUtc: dto.endUtc ? new Date(dto.endUtc) : null,
      isCancelled: dto.isCancelled ?? false,
      title: dto.title,
      description: dto.description,
      location: dto.location,
    });

    this.activityLog.logActivity({
      orgId,
      actorId: actorUserId,
      action: 'planning.event.exception.created',
      entityType: 'event',
      entityId: eventId,
      metadata: {
        originalStartUtc: originalStartUtc.toISOString(),
        isCancelled: dto.isCancelled ?? false,
      },
    });

    this.legalAudit.recordEvent({
      eventType: 'planning.event.exception.created',
      orgId,
      userId: actorUserId,
      triggerType: 'user',
      metadata: { eventId, originalStartUtc: originalStartUtc.toISOString() },
    });

    return exception;
  }

  /**
   * Splits a recurring series at a given occurrence, creating a new tail event.
   *
   * This implements the "This and Following" recurrence modification mode:
   * - The original event's RRULE is truncated so it ends before `originalStartUtc`.
   * - A new Event is created for the tail of the series, starting at `originalStartUtc`
   *   (or a rescheduled time if `dto.startUtc` is provided).
   * - Attendees are duplicated to the new event (RSVP statuses preserved).
   * - EventException rows at/after the split point are migrated to the new event.
   * - Invited attendees receive an invite notification for the new event (fire-and-forget).
   *
   * Returns the new tail event detail.
   */
  async splitSeries(
    orgId: string,
    eventId: string,
    dto: SplitSeriesInput,
    actorUserId: string,
    actorRole: MembershipRole,
  ): Promise<EventDetail> {
    const event = await this.repo.findEventById(eventId, orgId);
    if (!event) {
      throw new NotFoundException(`Event ${eventId} not found`);
    }
    if (!event.rrule) {
      throw new BadRequestException(
        'Cannot split a non-recurring event. Only recurring events can be split.',
      );
    }

    this.assertCanModify(event, actorUserId, actorRole);

    // Validate that originalStartUtc is actually a valid occurrence of this event.
    const splitPointUtc = new Date(dto.originalStartUtc);
    if (isNaN(splitPointUtc.getTime())) {
      throw new BadRequestException(
        `originalStartUtc is not a valid ISO 8601 date: "${dto.originalStartUtc}"`,
      );
    }

    // Expand a small window around the split point to verify the occurrence exists.
    const windowStart = new Date(splitPointUtc.getTime() - 1000);
    const windowEnd = new Date(splitPointUtc.getTime() + 1000);
    const candidates = this.recurrenceService.expand(
      event,
      windowStart,
      windowEnd,
    );
    const occurrenceExists = candidates.some(
      (occ) => occ.originalStartUtc.getTime() === splitPointUtc.getTime(),
    );
    if (!occurrenceExists) {
      throw new BadRequestException(
        `No occurrence found at originalStartUtc "${dto.originalStartUtc}" for event ${eventId}.`,
      );
    }

    // Verify version for optimistic locking.
    if (event.version !== dto.version) {
      throw new ConflictException(
        `Event ${eventId} was modified by another request (expected version ${dto.version}, current is ${event.version}). Refresh and retry.`,
      );
    }

    // Compute tail start/end from occurrence (fall through to dto overrides).
    const durationMs = event.endUtc.getTime() - event.startUtc.getTime();
    const tailStartUtc = dto.startUtc ? new Date(dto.startUtc) : splitPointUtc;
    const tailEndUtc = dto.endUtc
      ? new Date(dto.endUtc)
      : new Date(tailStartUtc.getTime() + durationMs);

    if (tailEndUtc <= tailStartUtc) {
      throw new BadRequestException('end must be after start');
    }

    const truncatedRrule = this.recurrenceService.truncateRrule(
      event.rrule,
      splitPointUtc,
    );
    const tailRrule = this.recurrenceService.stripCountAndUntil(event.rrule);

    const params: SplitSeriesParams = {
      original: event,
      splitPointUtc,
      truncatedRrule,
      tailRrule,
      tailRruleUntilUtc: event.rruleUntilUtc,
      tailStartUtc,
      tailEndUtc,
      overrides: {
        title: dto.title,
        description: dto.description,
        location: dto.location,
      },
    };

    const { newEvent } = await this.repo.splitSeries(params);

    // Notify all attendees of the new series (fire-and-forget).
    const attendeeIdsToNotify = newEvent.attendees
      .map((a) => a.userId)
      .filter((uid) => uid !== actorUserId);

    if (attendeeIdsToNotify.length > 0) {
      this.sendInviteNotifications(
        attendeeIdsToNotify,
        orgId,
        newEvent.id,
        newEvent.title,
      ).catch((err: unknown) => {
        this.logger.error(
          `Failed to send invite notifications for split series event ${newEvent.id}: ${err instanceof Error ? err.message : 'unknown error'}`,
        );
      });
    }

    this.activityLog.logActivity({
      orgId,
      actorId: actorUserId,
      action: 'planning.event.series.split',
      entityType: 'event',
      entityId: eventId,
      metadata: {
        splitPointUtc: splitPointUtc.toISOString(),
        newEventId: newEvent.id,
      },
    });

    this.legalAudit.recordEvent({
      eventType: 'planning.event.series.split',
      orgId,
      userId: actorUserId,
      triggerType: 'user',
      metadata: {
        originalEventId: eventId,
        newEventId: newEvent.id,
        splitPointUtc: splitPointUtc.toISOString(),
      },
    });

    return newEvent;
  }

  /**
   * Asserts that the actor may modify the event.
   * ADMIN and OWNER can always modify. MEMBER can only modify events they created.
   */
  private assertCanModify(
    event: Event,
    actorUserId: string,
    actorRole: MembershipRole,
  ): void {
    const isAdminOrAbove =
      actorRole === MembershipRole.ADMIN || actorRole === MembershipRole.OWNER;

    if (!isAdminOrAbove && event.createdByUserId !== actorUserId) {
      throw new ForbiddenException(
        'Only the event creator or an admin can modify this event',
      );
    }
  }

  private async sendInviteNotifications(
    userIds: string[],
    orgId: string,
    eventId: string,
    eventTitle: string,
  ): Promise<void> {
    await Promise.allSettled(
      userIds.map((userId) =>
        this.notificationsService.notifyUser(userId, orgId, {
          type: 'event.invite',
          title: 'You have been invited to an event',
          body: `You have been invited to "${eventTitle}"`,
          metadata: { entityRef: { type: 'event', id: eventId } },
        }),
      ),
    );
  }

  private async sendUpdateNotifications(
    userIds: string[],
    orgId: string,
    eventId: string,
    eventTitle: string,
  ): Promise<void> {
    await Promise.allSettled(
      userIds.map((userId) =>
        this.notificationsService.notifyUser(userId, orgId, {
          type: 'event.updated',
          title: 'An event has been updated',
          body: `"${eventTitle}" has been updated`,
          metadata: { entityRef: { type: 'event', id: eventId } },
        }),
      ),
    );
  }

  private async sendCancelNotifications(
    userIds: string[],
    orgId: string,
    eventId: string,
    eventTitle: string,
  ): Promise<void> {
    await Promise.allSettled(
      userIds.map((userId) =>
        this.notificationsService.notifyUser(userId, orgId, {
          type: 'event.cancelled',
          title: 'An event has been cancelled',
          body: `"${eventTitle}" has been cancelled`,
          metadata: { entityRef: { type: 'event', id: eventId } },
        }),
      ),
    );
  }
}
