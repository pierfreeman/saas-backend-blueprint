import {
  Event,
  EventAttendee,
  EventException,
  EventOccurrenceAttendee,
  Prisma,
  PrismaBusinessService,
  RSVPStatus,
} from '@libs/prisma-business';
import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

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
  occurrenceAttendees: EventOccurrenceAttendee[];
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
   * Returns non-soft-deleted events that have a reminder configured and are
   * still within the relevant window for sending reminders.
   *
   * `cutoff` is typically `now - MAX_REMINDER_MINUTES` calculated by the caller.
   * Events/series that ended before `cutoff` cannot produce any outstanding
   * reminder and are excluded at the DB level to avoid full-table scans.
   *
   * - Non-recurring: only fetched when not yet notified (`lastReminderOccurrenceUtc`
   *   is null) and the event start is at or after `cutoff`.
   * - Recurring: fetched unless the series definitively ended before `cutoff`
   *   (`rruleUntilUtc` is not null and before `cutoff`).
   */
  async findEventsWithReminders(cutoff: Date): Promise<EventWithRelations[]> {
    return this.prisma.event.findMany({
      where: {
        reminderMinutes: { not: null },
        deletedAt: null,
        OR: [
          // Non-recurring: reminder not yet sent and start is within the window.
          {
            rrule: null,
            lastReminderOccurrenceUtc: null,
            startUtc: { gte: cutoff },
          },
          // Recurring: series has not definitively ended before the cutoff.
          {
            rrule: { not: null },
            OR: [{ rruleUntilUtc: null }, { rruleUntilUtc: { gte: cutoff } }],
          },
        ],
      },
      include: { attendees: true, occurrenceAttendees: true, exceptions: true },
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
        occurrenceAttendees: true,
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
        occurrenceAttendees: true,
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
        occurrenceAttendees: true,
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
      include: { attendees: true, occurrenceAttendees: true, exceptions: true },
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
   * Upserts a per-occurrence RSVP override.
   * Overwrites the status if a row already exists for this (eventId, userId, originalStartUtc).
   */
  async upsertOccurrenceAttendee(
    eventId: string,
    userId: string,
    originalStartUtc: Date,
    status: RSVPStatus,
  ): Promise<EventOccurrenceAttendee> {
    return this.prisma.eventOccurrenceAttendee.upsert({
      where: {
        eventId_userId_originalStartUtc: { eventId, userId, originalStartUtc },
      },
      create: { eventId, userId, originalStartUtc, status },
      update: { status },
    });
  }

  /**
   * Adds a user to the master attendee list with `defaultStatus` only when they
   * are not already listed. If they already have a master RSVP, it is preserved.
   */
  async ensureAttendee(
    eventId: string,
    userId: string,
    defaultStatus: RSVPStatus,
  ): Promise<EventAttendee> {
    const existing = await this.prisma.eventAttendee.findUnique({
      where: { eventId_userId: { eventId, userId } },
    });
    if (existing) return existing;
    return this.prisma.eventAttendee.create({
      data: { eventId, userId, status: defaultStatus },
    });
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

  /**
   * Atomically splits a recurring series at `splitPointUtc`.
   *
   * Within a single Prisma transaction:
   * 1. Truncates the original event's RRULE by setting its `rrule` to
   *    `truncatedRrule` and `rruleUntilUtc` to `splitPointUtc - 1ms`.
   * 2. Creates a new Event (the tail series) with `tailStartUtc` as its start,
   *    applying `overrides` on top of the original event's fields.
   * 3. Copies all attendees from the original event to the new event, preserving
   *    their RSVP statuses.
   * 4. Migrates EventException rows with `originalStartUtc >= splitPointUtc`
   *    from the original event to the new event.
   *
   * Returns both the updated original and the newly created tail event.
   */
  async splitSeries(params: SplitSeriesParams): Promise<{
    updatedOriginal: EventWithRelations;
    newEvent: EventWithRelations;
  }> {
    const {
      original,
      splitPointUtc,
      truncatedRrule,
      tailRrule,
      tailRruleUntilUtc,
      tailStartUtc,
      tailEndUtc,
      overrides,
    } = params;

    const result = await this.prisma.$transaction(async (tx) => {
      // 1. Truncate the original series.
      await tx.event.update({
        where: { id: original.id },
        data: {
          rrule: truncatedRrule,
          rruleUntilUtc: new Date(splitPointUtc.getTime() - 1),
          version: { increment: 1 },
        },
      });

      // 2. Create the new tail event.
      const newEvent = await tx.event.create({
        data: {
          orgId: original.orgId,
          createdByUserId: original.createdByUserId,
          title: overrides.title ?? original.title,
          description: overrides.description ?? original.description,
          location: overrides.location ?? original.location,
          startUtc: tailStartUtc,
          endUtc: tailEndUtc,
          isAllDay: original.isAllDay,
          eventTimezone: original.eventTimezone,
          rrule: tailRrule,
          rruleUntilUtc: tailRruleUntilUtc,
          metadata: original.metadata ?? Prisma.JsonNull,
          reminderMinutes: original.reminderMinutes,
          // Reset high-water mark so the cron sweep re-evaluates reminders for the tail series.
          lastReminderOccurrenceUtc: null,
        },
      });

      // 3. Copy attendees from original to new event.
      if (original.attendees.length > 0) {
        await tx.eventAttendee.createMany({
          data: original.attendees.map((a) => ({
            eventId: newEvent.id,
            userId: a.userId,
            status: a.status,
          })),
          skipDuplicates: true,
        });
      }

      // 4. Migrate exceptions at or after the split point.
      const futureExceptions = original.exceptions.filter(
        (ex) => ex.originalStartUtc >= splitPointUtc,
      );

      if (futureExceptions.length > 0) {
        // Remove from original.
        await tx.eventException.deleteMany({
          where: {
            eventId: original.id,
            originalStartUtc: { gte: splitPointUtc },
          },
        });

        // Create on new event.
        await tx.eventException.createMany({
          data: futureExceptions.map((ex) => ({
            eventId: newEvent.id,
            originalStartUtc: ex.originalStartUtc,
            startUtc: ex.startUtc,
            endUtc: ex.endUtc,
            isCancelled: ex.isCancelled,
            title: ex.title,
            description: ex.description,
            location: ex.location,
          })),
          skipDuplicates: true,
        });
      }

      // 5. Migrate per-occurrence RSVP overrides at or after the split point.
      const futureOccurrenceAttendees = original.occurrenceAttendees.filter(
        (oa) => oa.originalStartUtc >= splitPointUtc,
      );
      if (futureOccurrenceAttendees.length > 0) {
        await tx.eventOccurrenceAttendee.deleteMany({
          where: {
            eventId: original.id,
            originalStartUtc: { gte: splitPointUtc },
          },
        });
        await tx.eventOccurrenceAttendee.createMany({
          data: futureOccurrenceAttendees.map((oa) => ({
            eventId: newEvent.id,
            userId: oa.userId,
            originalStartUtc: oa.originalStartUtc,
            status: oa.status,
          })),
          skipDuplicates: true,
        });
      }

      return newEvent;
    });

    // Re-fetch both events with their relations for the caller.
    const include = {
      attendees: true,
      occurrenceAttendees: true,
      exceptions: true,
    } as const;
    const [updatedOriginal, newEventWithRelations] = await Promise.all([
      this.prisma.event.findUniqueOrThrow({
        where: { id: original.id },
        include,
      }),
      this.prisma.event.findUniqueOrThrow({
        where: { id: result.id },
        include,
      }),
    ]);

    return { updatedOriginal, newEvent: newEventWithRelations };
  }
}

// ── Supporting types ─────────────────────────────────────────────────────────

export interface SplitSeriesParams {
  /** The original recurring event (with attendees and exceptions pre-loaded). */
  original: EventWithRelations;
  /** UTC timestamp of the first occurrence that belongs to the new tail series. */
  splitPointUtc: Date;
  /** Truncated RRULE string for the original event (ends before the split point). */
  truncatedRrule: string;
  /** RRULE string for the tail event (no COUNT/UNTIL — governed by `tailRruleUntilUtc`). */
  tailRrule: string;
  /** Effective UNTIL boundary for the tail, copied from original.rruleUntilUtc (or null). */
  tailRruleUntilUtc: Date | null;
  /** Computed UTC start for the first occurrence of the tail event. */
  tailStartUtc: Date;
  /** Computed UTC end for the first occurrence of the tail event. */
  tailEndUtc: Date;
  /** Optional field overrides to apply to the new tail event. */
  overrides: {
    title?: string;
    description?: string | null;
    location?: string | null;
  };
}
