import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaBusinessService } from '@libs/prisma-business';
import {
  Event,
  EventAttendee,
  EventException,
  Prisma,
  RSVPStatus,
} from '@prisma/client';

export interface CreateEventData {
  orgId: string;
  createdByUserId: string;
  title: string;
  description?: string | null;
  location?: string | null;
  startUtc: Date;
  endUtc: Date;
  isAllDay: boolean;
  eventTimezone: string;
  rrule?: string | null;
  rruleUntilUtc?: Date | null;
  metadata?: Prisma.InputJsonValue | null;
  reminderMinutes?: number | null;
}

export interface UpdateEventData {
  title?: string;
  description?: string | null;
  location?: string | null;
  startUtc?: Date;
  endUtc?: Date;
  isAllDay?: boolean;
  eventTimezone?: string;
  rrule?: string | null;
  rruleUntilUtc?: Date | null;
  metadata?: Prisma.InputJsonValue | null;
  reminderMinutes?: number | null;
}

export interface UpsertExceptionData {
  eventId: string;
  originalStartUtc: Date;
  startUtc?: Date | null;
  endUtc?: Date | null;
  isCancelled?: boolean;
  title?: string | null;
  description?: string | null;
  location?: string | null;
}

export type EventWithRelations = Event & {
  attendees: EventAttendee[];
  exceptions: EventException[];
};

@Injectable()
export class PlanningRepository {
  constructor(private readonly prisma: PrismaBusinessService) {}

  async createEvent(data: CreateEventData): Promise<Event> {
    return this.prisma.event.create({
      data: {
        orgId: data.orgId,
        createdByUserId: data.createdByUserId,
        title: data.title,
        description: data.description,
        location: data.location,
        startUtc: data.startUtc,
        endUtc: data.endUtc,
        isAllDay: data.isAllDay,
        eventTimezone: data.eventTimezone,
        rrule: data.rrule,
        rruleUntilUtc: data.rruleUntilUtc,
        metadata: data.metadata ?? Prisma.JsonNull,
        reminderMinutes: data.reminderMinutes ?? null,
      },
    });
  }

  /**
   * Returns all non-soft-deleted events that have a reminder configured.
   * Used by the cron sweep to find due reminders.
   */
  async findEventsWithReminders(): Promise<EventWithRelations[]> {
    return this.prisma.event.findMany({
      where: {
        reminderMinutes: { not: null },
        deletedAt: null,
      },
      include: { attendees: true, exceptions: true },
    });
  }

  /**
   * Records the UTC start of the most-recently-reminded occurrence.
   * The cron sweep uses this to skip occurrences that have already been notified.
   */
  async updateLastReminderSent(
    eventId: string,
    occurrenceUtc: Date,
  ): Promise<void> {
    await this.prisma.event.update({
      where: { id: eventId },
      data: { lastReminderOccurrenceUtc: occurrenceUtc },
    });
  }

  /**
   * Fetches events that may produce occurrences within the [from, to] range.
   * - Non-recurring events: startUtc falls within the window.
   * - Recurring events: started at or before `to`, and either have no UNTIL boundary
   *   or their UNTIL is after or equal to `from`.
   */
  async findEventsByRange(
    orgId: string,
    from: Date,
    to: Date,
  ): Promise<EventWithRelations[]> {
    return this.prisma.event.findMany({
      where: {
        orgId,
        deletedAt: null,
        OR: [
          {
            rrule: null,
            startUtc: { gte: from, lte: to },
          },
          {
            rrule: { not: null },
            startUtc: { lte: to },
            OR: [{ rruleUntilUtc: null }, { rruleUntilUtc: { gte: from } }],
          },
        ],
      },
      include: {
        attendees: true,
        exceptions: true,
      },
    });
  }

  /**
   * Fetches events that could conflict with [start, end) for a specific user.
   * User is considered involved when they are the creator or an attendee.
   */
  async findConflictCandidates(
    orgId: string,
    userId: string,
    start: Date,
    end: Date,
  ): Promise<EventWithRelations[]> {
    return this.prisma.event.findMany({
      where: {
        orgId,
        deletedAt: null,
        OR: [{ createdByUserId: userId }, { attendees: { some: { userId } } }],
        AND: [
          {
            OR: [
              // Single events that overlap [start, end)
              {
                rrule: null,
                startUtc: { lt: end },
                endUtc: { gt: start },
              },
              // Recurring masters that may yield occurrences in [start, end)
              {
                rrule: { not: null },
                startUtc: { lt: end },
                OR: [{ rruleUntilUtc: null }, { rruleUntilUtc: { gt: start } }],
              },
            ],
          },
        ],
      },
      include: {
        attendees: true,
        exceptions: true,
      },
    });
  }

  async findEventById(
    id: string,
    orgId: string,
  ): Promise<EventWithRelations | null> {
    return this.prisma.event.findFirst({
      where: { id, orgId, deletedAt: null },
      include: {
        attendees: true,
        exceptions: true,
      },
    });
  }

  /**
   * Updates event fields with optimistic locking.
   * The WHERE clause includes the current `version`; if another request
   * has already incremented it, `updateMany` returns count=0 → 409 Conflict.
   */
  async updateEvent(
    id: string,
    orgId: string,
    version: number,
    data: UpdateEventData,
  ): Promise<EventWithRelations> {
    const { metadata, ...rest } = data;
    const result = await this.prisma.event.updateMany({
      where: { id, orgId, version, deletedAt: null },
      data: {
        ...rest,
        ...(metadata === undefined
          ? {}
          : { metadata: metadata ?? Prisma.JsonNull }),
        version: { increment: 1 },
      },
    });

    if (result.count === 0) {
      const existing = await this.prisma.event.findFirst({
        where: { id, orgId, deletedAt: null },
      });
      if (!existing) {
        throw new NotFoundException(`Event ${id} not found`);
      }
      throw new ConflictException(
        `Event ${id} was modified by another request (expected version ${version}, current is ${existing.version}). Refresh and retry.`,
      );
    }

    return this.prisma.event.findUniqueOrThrow({
      where: { id },
      include: { attendees: true, exceptions: true },
    });
  }

  async softDeleteEvent(id: string, orgId: string): Promise<void> {
    await this.prisma.event.updateMany({
      where: { id, orgId, deletedAt: null },
      data: { deletedAt: new Date() },
    });
  }

  async upsertAttendee(
    eventId: string,
    userId: string,
    status: RSVPStatus,
  ): Promise<EventAttendee> {
    return this.prisma.eventAttendee.upsert({
      where: { eventId_userId: { eventId, userId } },
      create: { eventId, userId, status },
      update: { status },
    });
  }

  async findAttendee(
    eventId: string,
    userId: string,
  ): Promise<EventAttendee | null> {
    return this.prisma.eventAttendee.findUnique({
      where: { eventId_userId: { eventId, userId } },
    });
  }

  async findAttendees(eventId: string): Promise<EventAttendee[]> {
    return this.prisma.eventAttendee.findMany({ where: { eventId } });
  }

  /**
   * Removes all attendee records for the event whose userId is NOT in keepUserIds.
   * Used to sync the attendee list during an update (set semantics).
   */
  async deleteAttendeesExcluding(
    eventId: string,
    keepUserIds: string[],
  ): Promise<void> {
    await this.prisma.eventAttendee.deleteMany({
      where: {
        eventId,
        userId: { notIn: keepUserIds },
      },
    });
  }

  async upsertException(data: UpsertExceptionData): Promise<EventException> {
    return this.prisma.eventException.upsert({
      where: {
        eventId_originalStartUtc: {
          eventId: data.eventId,
          originalStartUtc: data.originalStartUtc,
        },
      },
      create: {
        eventId: data.eventId,
        originalStartUtc: data.originalStartUtc,
        startUtc: data.startUtc,
        endUtc: data.endUtc,
        isCancelled: data.isCancelled ?? false,
        title: data.title,
        description: data.description,
        location: data.location,
      },
      update: {
        startUtc: data.startUtc,
        endUtc: data.endUtc,
        isCancelled: data.isCancelled ?? false,
        title: data.title,
        description: data.description,
        location: data.location,
      },
    });
  }
}
