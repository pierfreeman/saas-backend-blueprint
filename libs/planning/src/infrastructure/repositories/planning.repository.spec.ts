import { ConflictException, NotFoundException } from '@nestjs/common';
import { PrismaBusinessService } from '@libs/prisma-business';
import { Prisma, RSVPStatus } from '@libs/prisma-business';
import { vi } from 'vitest';
import { PlanningRepository } from './planning.repository';

// ── Prisma mock ───────────────────────────────────────────────────────────────

const mockPrisma = {
  $transaction: vi.fn(),
  event: {
    create: vi.fn(),
    findMany: vi.fn(),
    findFirst: vi.fn(),
    findUniqueOrThrow: vi.fn(),
    updateMany: vi.fn(),
    update: vi.fn(),
  },
  eventAttendee: {
    upsert: vi.fn(),
    findUnique: vi.fn(),
    findMany: vi.fn(),
    deleteMany: vi.fn(),
    createMany: vi.fn(),
  },
  eventException: {
    upsert: vi.fn(),
    deleteMany: vi.fn(),
    createMany: vi.fn(),
  },
} as unknown as PrismaBusinessService;

// ── Fixtures ──────────────────────────────────────────────────────────────────

const baseEvent = {
  id: 'event-1',
  orgId: 'org-1',
  createdByUserId: 'user-1',
  title: 'Test Event',
  description: null,
  location: null,
  startUtc: new Date('2026-01-05T10:00:00Z'),
  endUtc: new Date('2026-01-05T11:00:00Z'),
  isAllDay: false,
  eventTimezone: 'UTC',
  rrule: null,
  rruleUntilUtc: null,
  metadata: null,
  version: 1,
  deletedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const baseEventWithRelations = {
  ...baseEvent,
  attendees: [],
  occurrenceAttendees: [],
  exceptions: [],
};

const baseAttendee = {
  id: 'att-1',
  eventId: 'event-1',
  userId: 'user-1',
  status: RSVPStatus.YES,
  createdAt: new Date(),
};

const baseException = {
  id: 'ex-1',
  eventId: 'event-1',
  originalStartUtc: new Date('2026-01-12T10:00:00Z'),
  startUtc: null,
  endUtc: null,
  isCancelled: false,
  title: null,
  description: null,
  location: null,
  createdAt: new Date(),
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('PlanningRepository', () => {
  let repo: PlanningRepository;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = new PlanningRepository(mockPrisma);
  });

  // ── findEventsWithReminders ────────────────────────────────────────────────

  describe('findEventsWithReminders', () => {
    it('returns events that have a reminder configured', async () => {
      const eventWithReminder = {
        ...baseEventWithRelations,
        reminderMinutes: 30,
      };
      mockPrisma.event.findMany = vi
        .fn()
        .mockResolvedValue([eventWithReminder]);

      const cutoff = new Date('2026-01-04T10:00:00Z');
      const result = await repo.findEventsWithReminders(cutoff);

      expect(result).toHaveLength(1);
      expect(mockPrisma.event.findMany).toHaveBeenCalledWith({
        where: {
          reminderMinutes: { not: null },
          deletedAt: null,
          OR: [
            {
              rrule: null,
              lastReminderOccurrenceUtc: null,
              startUtc: { gte: cutoff },
            },
            {
              rrule: { not: null },
              OR: [{ rruleUntilUtc: null }, { rruleUntilUtc: { gte: cutoff } }],
            },
          ],
        },
        include: {
          attendees: true,
          occurrenceAttendees: true,
          exceptions: true,
        },
      });
    });

    it('excludes non-recurring events in the past (start before cutoff)', async () => {
      mockPrisma.event.findMany = vi.fn().mockResolvedValue([]);

      const cutoff = new Date('2026-01-05T10:00:00Z');
      await repo.findEventsWithReminders(cutoff);

      // The WHERE clause must include the cutoff-based OR filter.
      const where = (mockPrisma.event.findMany as ReturnType<typeof vi.fn>).mock
        .calls[0][0].where;
      expect(where.OR[0]).toMatchObject({
        rrule: null,
        lastReminderOccurrenceUtc: null,
        startUtc: { gte: cutoff },
      });
      expect(where.OR[1]).toMatchObject({
        rrule: { not: null },
      });
    });

    it('returns empty array when no events have reminders', async () => {
      mockPrisma.event.findMany = vi.fn().mockResolvedValue([]);

      const result = await repo.findEventsWithReminders(new Date());

      expect(result).toEqual([]);
    });
  });

  // ── updateLastReminderSent ────────────────────────────────────────────────

  describe('updateLastReminderSent', () => {
    it('calls prisma.event.update with the correct occurrence UTC', async () => {
      mockPrisma.event.update = vi.fn().mockResolvedValue(baseEvent);

      const occurrenceUtc = new Date('2026-01-05T10:00:00Z');
      await repo.updateLastReminderSent('event-1', occurrenceUtc);

      expect(mockPrisma.event.update).toHaveBeenCalledWith({
        where: { id: 'event-1' },
        data: { lastReminderOccurrenceUtc: occurrenceUtc },
      });
    });
  });

  // ── createEvent ─────────────────────────────────────────────────────────────

  describe('createEvent', () => {
    it('creates an event and returns it', async () => {
      mockPrisma.event.create = vi.fn().mockResolvedValue(baseEvent);

      const result = await repo.createEvent({
        orgId: 'org-1',
        createdByUserId: 'user-1',
        title: 'Test Event',
        startUtc: new Date('2026-01-05T10:00:00Z'),
        endUtc: new Date('2026-01-05T11:00:00Z'),
        isAllDay: false,
        eventTimezone: 'UTC',
      });

      expect(result).toBe(baseEvent);
      expect(mockPrisma.event.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            orgId: 'org-1',
            title: 'Test Event',
          }),
        }),
      );
    });

    it('stores Prisma.JsonNull when metadata is null', async () => {
      mockPrisma.event.create = vi.fn().mockResolvedValue(baseEvent);

      await repo.createEvent({
        orgId: 'org-1',
        createdByUserId: 'user-1',
        title: 'Test Event',
        startUtc: new Date(),
        endUtc: new Date(),
        isAllDay: false,
        eventTimezone: 'UTC',
        metadata: null,
      });

      expect(mockPrisma.event.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ metadata: Prisma.JsonNull }),
        }),
      );
    });

    it('passes through a provided metadata object', async () => {
      mockPrisma.event.create = vi.fn().mockResolvedValue(baseEvent);
      const meta = { key: 'value' };

      await repo.createEvent({
        orgId: 'org-1',
        createdByUserId: 'user-1',
        title: 'Test Event',
        startUtc: new Date(),
        endUtc: new Date(),
        isAllDay: false,
        eventTimezone: 'UTC',
        metadata: meta,
      });

      expect(mockPrisma.event.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ metadata: meta }),
        }),
      );
    });
  });

  // ── findEventsByRange ───────────────────────────────────────────────────────

  describe('findEventsByRange', () => {
    it('queries with org and date range filters', async () => {
      mockPrisma.event.findMany = vi
        .fn()
        .mockResolvedValue([baseEventWithRelations]);

      const from = new Date('2026-01-01T00:00:00Z');
      const to = new Date('2026-01-31T23:59:59Z');
      const result = await repo.findEventsByRange('org-1', from, to);

      expect(result).toHaveLength(1);
      expect(mockPrisma.event.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            orgId: 'org-1',
            deletedAt: null,
          }),
          include: {
            attendees: true,
            occurrenceAttendees: true,
            exceptions: true,
          },
        }),
      );
    });

    it('returns empty array when no events exist in range', async () => {
      mockPrisma.event.findMany = vi.fn().mockResolvedValue([]);

      const result = await repo.findEventsByRange(
        'org-1',
        new Date(),
        new Date(),
      );

      expect(result).toEqual([]);
    });
  });

  // ── findConflictCandidates ────────────────────────────────────────────────

  describe('findConflictCandidates', () => {
    it('queries user-involved events that may overlap the requested range', async () => {
      mockPrisma.event.findMany = vi
        .fn()
        .mockResolvedValue([baseEventWithRelations]);

      const start = new Date('2026-01-05T10:00:00Z');
      const end = new Date('2026-01-05T11:00:00Z');

      const result = await repo.findConflictCandidates(
        'org-1',
        'user-1',
        start,
        end,
      );

      expect(result).toHaveLength(1);
      expect(mockPrisma.event.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            orgId: 'org-1',
            deletedAt: null,
          }),
          include: {
            attendees: true,
            occurrenceAttendees: true,
            exceptions: true,
          },
        }),
      );
    });
  });

  // ── findEventById ───────────────────────────────────────────────────────────

  describe('findEventById', () => {
    it('returns the event with relations when found', async () => {
      mockPrisma.event.findFirst = vi
        .fn()
        .mockResolvedValue(baseEventWithRelations);

      const result = await repo.findEventById('event-1', 'org-1');

      expect(result).toBe(baseEventWithRelations);
      expect(mockPrisma.event.findFirst).toHaveBeenCalledWith({
        where: { id: 'event-1', orgId: 'org-1', deletedAt: null },
        include: {
          attendees: true,
          occurrenceAttendees: true,
          exceptions: true,
        },
      });
    });

    it('returns null when event is not found', async () => {
      mockPrisma.event.findFirst = vi.fn().mockResolvedValue(null);

      const result = await repo.findEventById('missing', 'org-1');

      expect(result).toBeNull();
    });
  });

  // ── updateEvent ─────────────────────────────────────────────────────────────

  describe('updateEvent', () => {
    it('updates and returns the refreshed event', async () => {
      const updated = {
        ...baseEventWithRelations,
        title: 'Updated',
        version: 2,
      };
      mockPrisma.event.updateMany = vi.fn().mockResolvedValue({ count: 1 });
      mockPrisma.event.findUniqueOrThrow = vi.fn().mockResolvedValue(updated);

      const result = await repo.updateEvent('event-1', 'org-1', 1, {
        title: 'Updated',
      });

      expect(result).toBe(updated);
      expect(mockPrisma.event.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'event-1', orgId: 'org-1', version: 1, deletedAt: null },
          data: expect.objectContaining({ version: { increment: 1 } }),
        }),
      );
    });

    it('throws ConflictException when version is stale', async () => {
      mockPrisma.event.updateMany = vi.fn().mockResolvedValue({ count: 0 });
      mockPrisma.event.findFirst = vi
        .fn()
        .mockResolvedValue({ ...baseEvent, version: 2 });

      await expect(
        repo.updateEvent('event-1', 'org-1', 1, { title: 'Updated' }),
      ).rejects.toThrow(ConflictException);
    });

    it('throws NotFoundException when event is missing on stale count=0', async () => {
      mockPrisma.event.updateMany = vi.fn().mockResolvedValue({ count: 0 });
      mockPrisma.event.findFirst = vi.fn().mockResolvedValue(null);

      await expect(
        repo.updateEvent('event-1', 'org-1', 1, { title: 'Updated' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('omits metadata from update payload when not provided', async () => {
      mockPrisma.event.updateMany = vi.fn().mockResolvedValue({ count: 1 });
      mockPrisma.event.findUniqueOrThrow = vi
        .fn()
        .mockResolvedValue(baseEventWithRelations);

      await repo.updateEvent('event-1', 'org-1', 1, { title: 'Updated' });

      const callArg = (mockPrisma.event.updateMany as ReturnType<typeof vi.fn>)
        .mock.calls[0][0];
      expect(callArg.data).not.toHaveProperty('metadata');
    });

    it('stores Prisma.JsonNull when metadata is explicitly null', async () => {
      mockPrisma.event.updateMany = vi.fn().mockResolvedValue({ count: 1 });
      mockPrisma.event.findUniqueOrThrow = vi
        .fn()
        .mockResolvedValue(baseEventWithRelations);

      await repo.updateEvent('event-1', 'org-1', 1, { metadata: null });

      const callArg = (mockPrisma.event.updateMany as ReturnType<typeof vi.fn>)
        .mock.calls[0][0];
      expect(callArg.data.metadata).toBe(Prisma.JsonNull);
    });
  });

  // ── softDeleteEvent ─────────────────────────────────────────────────────────

  describe('softDeleteEvent', () => {
    it('sets deletedAt on the matching event', async () => {
      mockPrisma.event.updateMany = vi.fn().mockResolvedValue({ count: 1 });

      await repo.softDeleteEvent('event-1', 'org-1');

      expect(mockPrisma.event.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'event-1', orgId: 'org-1', deletedAt: null },
          data: expect.objectContaining({ deletedAt: expect.any(Date) }),
        }),
      );
    });
  });

  // ── upsertAttendee ──────────────────────────────────────────────────────────

  describe('upsertAttendee', () => {
    it('upserts and returns the attendee', async () => {
      mockPrisma.eventAttendee.upsert = vi.fn().mockResolvedValue(baseAttendee);

      const result = await repo.upsertAttendee(
        'event-1',
        'user-1',
        RSVPStatus.YES,
      );

      expect(result).toBe(baseAttendee);
      expect(mockPrisma.eventAttendee.upsert).toHaveBeenCalledWith({
        where: { eventId_userId: { eventId: 'event-1', userId: 'user-1' } },
        create: {
          eventId: 'event-1',
          userId: 'user-1',
          status: RSVPStatus.YES,
        },
        update: { status: RSVPStatus.YES },
      });
    });
  });

  // ── findAttendee ────────────────────────────────────────────────────────────

  describe('findAttendee', () => {
    it('returns the attendee when found', async () => {
      mockPrisma.eventAttendee.findUnique = vi
        .fn()
        .mockResolvedValue(baseAttendee);

      const result = await repo.findAttendee('event-1', 'user-1');

      expect(result).toBe(baseAttendee);
      expect(mockPrisma.eventAttendee.findUnique).toHaveBeenCalledWith({
        where: { eventId_userId: { eventId: 'event-1', userId: 'user-1' } },
      });
    });

    it('returns null when attendee is not found', async () => {
      mockPrisma.eventAttendee.findUnique = vi.fn().mockResolvedValue(null);

      expect(await repo.findAttendee('event-1', 'unknown')).toBeNull();
    });
  });

  // ── findAttendees ───────────────────────────────────────────────────────────

  describe('findAttendees', () => {
    it('returns all attendees for an event', async () => {
      mockPrisma.eventAttendee.findMany = vi
        .fn()
        .mockResolvedValue([baseAttendee]);

      const result = await repo.findAttendees('event-1');

      expect(result).toHaveLength(1);
      expect(mockPrisma.eventAttendee.findMany).toHaveBeenCalledWith({
        where: { eventId: 'event-1' },
      });
    });
  });

  // ── deleteAttendeesExcluding ───────────────────────────────────────────────

  describe('deleteAttendeesExcluding', () => {
    it('deletes attendees whose userId is not in the keep list', async () => {
      mockPrisma.eventAttendee.deleteMany = vi
        .fn()
        .mockResolvedValue({ count: 1 });

      await repo.deleteAttendeesExcluding('event-1', ['user-1', 'user-2']);

      expect(mockPrisma.eventAttendee.deleteMany).toHaveBeenCalledWith({
        where: {
          eventId: 'event-1',
          userId: { notIn: ['user-1', 'user-2'] },
        },
      });
    });

    it('deletes all attendees when keep list is empty', async () => {
      mockPrisma.eventAttendee.deleteMany = vi
        .fn()
        .mockResolvedValue({ count: 2 });

      await repo.deleteAttendeesExcluding('event-1', []);

      expect(mockPrisma.eventAttendee.deleteMany).toHaveBeenCalledWith({
        where: {
          eventId: 'event-1',
          userId: { notIn: [] },
        },
      });
    });
  });

  // ── upsertException ─────────────────────────────────────────────────────────

  describe('upsertException', () => {
    it('upserts and returns the exception', async () => {
      mockPrisma.eventException.upsert = vi
        .fn()
        .mockResolvedValue(baseException);

      const originalStartUtc = new Date('2026-01-12T10:00:00Z');
      const result = await repo.upsertException({
        eventId: 'event-1',
        originalStartUtc,
        isCancelled: true,
        title: 'Cancelled',
        description: null,
        location: null,
      });

      expect(result).toBe(baseException);
      expect(mockPrisma.eventException.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            eventId_originalStartUtc: { eventId: 'event-1', originalStartUtc },
          },
          create: expect.objectContaining({
            eventId: 'event-1',
            isCancelled: true,
          }),
          update: expect.objectContaining({ isCancelled: true }),
        }),
      );
    });

    it('defaults isCancelled to false when not provided', async () => {
      mockPrisma.eventException.upsert = vi
        .fn()
        .mockResolvedValue(baseException);

      await repo.upsertException({
        eventId: 'event-1',
        originalStartUtc: new Date('2026-01-12T10:00:00Z'),
      });

      const callArg = (
        mockPrisma.eventException.upsert as ReturnType<typeof vi.fn>
      ).mock.calls[0][0];
      expect(callArg.create.isCancelled).toBe(false);
      expect(callArg.update.isCancelled).toBe(false);
    });
  });

  // ── splitSeries ─────────────────────────────────────────────────────────────

  describe('splitSeries', () => {
    const splitPoint = new Date('2026-01-08T10:00:00Z');

    // A fresh tx mock is recreated per test inside beforeEach.
    let mockTx: {
      event: {
        update: ReturnType<typeof vi.fn>;
        create: ReturnType<typeof vi.fn>;
      };
      eventAttendee: { createMany: ReturnType<typeof vi.fn> };
      eventException: {
        deleteMany: ReturnType<typeof vi.fn>;
        createMany: ReturnType<typeof vi.fn>;
      };
    };

    const tailEvent = {
      ...baseEvent,
      id: 'event-tail',
      startUtc: splitPoint,
      endUtc: new Date('2026-01-08T11:00:00Z'),
      rrule: 'FREQ=DAILY',
    };

    const originalWithRelationsAfter = {
      ...baseEventWithRelations,
      rrule: 'FREQ=DAILY;UNTIL=20260107T235959Z',
    };
    const tailWithRelations = {
      ...tailEvent,
      attendees: [],
      occurrenceAttendees: [],
      exceptions: [],
    };

    function makeParams(
      overrides: Partial<Parameters<typeof repo.splitSeries>[0]> = {},
    ) {
      return {
        original: baseEventWithRelations,
        splitPointUtc: splitPoint,
        truncatedRrule: 'FREQ=DAILY;UNTIL=20260107T235959Z',
        tailRrule: 'FREQ=DAILY',
        tailRruleUntilUtc: null,
        tailStartUtc: splitPoint,
        tailEndUtc: new Date('2026-01-08T11:00:00Z'),
        overrides: {},
        ...overrides,
      };
    }

    beforeEach(() => {
      mockTx = {
        event: {
          update: vi.fn().mockResolvedValue({}),
          create: vi.fn().mockResolvedValue(tailEvent),
        },
        eventAttendee: { createMany: vi.fn().mockResolvedValue({}) },
        eventException: {
          deleteMany: vi.fn().mockResolvedValue({}),
          createMany: vi.fn().mockResolvedValue({}),
        },
        $executeRaw: vi.fn(),
      };
      (
        mockPrisma as unknown as { $transaction: ReturnType<typeof vi.fn> }
      ).$transaction = vi
        .fn()
        .mockImplementation(
          async (fn: (tx: typeof mockTx) => Promise<unknown>) => fn(mockTx),
        );

      // findUniqueOrThrow is called twice after the transaction (original + tail).
      mockPrisma.event.findUniqueOrThrow = vi
        .fn()
        .mockResolvedValueOnce(originalWithRelationsAfter)
        .mockResolvedValueOnce(tailWithRelations);
    });

    it('returns updatedOriginal and newEvent after a successful transaction', async () => {
      const { updatedOriginal, newEvent } =
        await repo.splitSeries(makeParams());

      expect(updatedOriginal).toEqual(originalWithRelationsAfter);
      expect(newEvent).toEqual(tailWithRelations);
    });

    it('truncates the original event inside the transaction', async () => {
      await repo.splitSeries(makeParams());

      expect(mockTx.event.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'event-1' },
          data: expect.objectContaining({
            rrule: 'FREQ=DAILY;UNTIL=20260107T235959Z',
            rruleUntilUtc: new Date(splitPoint.getTime() - 1),
          }),
        }),
      );
    });

    it('creates the tail event with tail RRULE and overrides applied', async () => {
      await repo.splitSeries(
        makeParams({
          overrides: {
            title: 'Overridden title',
            description: null,
            location: null,
          },
        }),
      );

      expect(mockTx.event.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            rrule: 'FREQ=DAILY',
            title: 'Overridden title',
            description: null,
            location: null,
            lastReminderOccurrenceUtc: null,
          }),
        }),
      );
    });

    it('uses original title and fields when no overrides are provided', async () => {
      await repo.splitSeries(makeParams({ overrides: {} }));

      expect(mockTx.event.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ title: baseEvent.title }),
        }),
      );
    });

    it('stores Prisma.JsonNull when original.metadata is null', async () => {
      await repo.splitSeries(makeParams());

      expect(mockTx.event.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ metadata: Prisma.JsonNull }),
        }),
      );
    });

    it('copies attendees when original has attendees', async () => {
      const original = {
        ...baseEventWithRelations,
        attendees: [
          { ...baseAttendee, userId: 'user-1', status: RSVPStatus.YES },
          {
            ...baseAttendee,
            id: 'att-2',
            userId: 'user-2',
            status: RSVPStatus.PENDING,
          },
        ],
      };

      await repo.splitSeries(makeParams({ original }));

      expect(mockTx.eventAttendee.createMany).toHaveBeenCalledWith({
        data: [
          { eventId: tailEvent.id, userId: 'user-1', status: RSVPStatus.YES },
          {
            eventId: tailEvent.id,
            userId: 'user-2',
            status: RSVPStatus.PENDING,
          },
        ],
        skipDuplicates: true,
      });
    });

    it('skips eventAttendee.createMany when original has no attendees', async () => {
      await repo.splitSeries(makeParams({ original: baseEventWithRelations }));

      expect(mockTx.eventAttendee.createMany).not.toHaveBeenCalled();
    });

    it('migrates exceptions at or after the split point', async () => {
      const futureException = {
        ...baseException,
        originalStartUtc: splitPoint,
      };
      const pastException = {
        ...baseException,
        id: 'ex-past',
        originalStartUtc: new Date('2026-01-06T10:00:00Z'),
      };
      const original = {
        ...baseEventWithRelations,
        exceptions: [pastException, futureException],
      };

      await repo.splitSeries(makeParams({ original }));

      expect(mockTx.eventException.deleteMany).toHaveBeenCalledWith({
        where: { eventId: 'event-1', originalStartUtc: { gte: splitPoint } },
      });
      expect(mockTx.eventException.createMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: [
            expect.objectContaining({
              eventId: tailEvent.id,
              originalStartUtc: splitPoint,
            }),
          ],
          skipDuplicates: true,
        }),
      );
    });

    it('skips exception migration when no exceptions are at or after split point', async () => {
      const original = {
        ...baseEventWithRelations,
        exceptions: [
          {
            ...baseException,
            originalStartUtc: new Date('2026-01-06T10:00:00Z'),
          },
        ],
      };

      await repo.splitSeries(makeParams({ original }));

      expect(mockTx.eventException.deleteMany).not.toHaveBeenCalled();
      expect(mockTx.eventException.createMany).not.toHaveBeenCalled();
    });

    it('skips exception migration when original has no exceptions at all', async () => {
      await repo.splitSeries(makeParams({ original: baseEventWithRelations }));

      expect(mockTx.eventException.deleteMany).not.toHaveBeenCalled();
      expect(mockTx.eventException.createMany).not.toHaveBeenCalled();
    });

    it('re-fetches both events with relations after the transaction', async () => {
      await repo.splitSeries(makeParams());

      expect(mockPrisma.event.findUniqueOrThrow).toHaveBeenCalledTimes(2);
      expect(mockPrisma.event.findUniqueOrThrow).toHaveBeenCalledWith({
        where: { id: 'event-1' },
        include: {
          attendees: true,
          occurrenceAttendees: true,
          exceptions: true,
        },
      });
      expect(mockPrisma.event.findUniqueOrThrow).toHaveBeenCalledWith({
        where: { id: tailEvent.id },
        include: {
          attendees: true,
          occurrenceAttendees: true,
          exceptions: true,
        },
      });
    });

    it('preserves tailRruleUntilUtc on the new event', async () => {
      const until = new Date('2026-06-30T23:59:59Z');
      await repo.splitSeries(makeParams({ tailRruleUntilUtc: until }));

      expect(mockTx.event.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ rruleUntilUtc: until }),
        }),
      );
    });
  });
});
