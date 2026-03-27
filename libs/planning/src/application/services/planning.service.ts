import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ActivityLogService } from '@libs/activity-log';
import { LegalAuditService } from '@libs/legal-audit';
import { NotificationsService } from '@libs/notifications';
import {
  Event,
  EventAttendee,
  EventException,
  MembershipRole,
  Prisma,
  RSVPStatus,
} from '@prisma/client';
import {
  PlanningRepository,
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
    };

    // Strip undefined keys to avoid overwriting unchanged fields
    for (const key of Object.keys(updateData) as (keyof UpdateEventData)[]) {
      if (updateData[key] === undefined) {
        delete updateData[key];
      }
    }

    const updated = await this.repo.updateEvent(
      id,
      orgId,
      dto.version,
      updateData,
    );

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
      this.notificationsService
        .notifyUser(event.createdByUserId, orgId, {
          type: 'event.rsvp',
          title: 'RSVP updated',
          body: `A member responded "${status}" to "${event.title}"`,
          metadata: { eventId, userId: actorUserId, status },
        })
        .catch((err: unknown) => {
          this.logger.error(
            `Failed to send RSVP notification for event ${eventId}: ${err instanceof Error ? err.message : 'unknown error'}`,
          );
        });
    }

    return attendee;
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
          metadata: { eventId },
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
          metadata: { eventId },
        }),
      ),
    );
  }
}
