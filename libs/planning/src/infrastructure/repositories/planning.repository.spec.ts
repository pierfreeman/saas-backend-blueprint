import { ConflictException, NotFoundException } from '@nestjs/common';
import { PrismaBusinessService } from '@libs/prisma-business';
import { Prisma, RSVPStatus } from '@prisma/client';
import { vi } from 'vitest';
import { PlanningRepository } from './planning.repository';

// ── Prisma mock ───────────────────────────────────────────────────────────────

const mockPrisma = {
  event: {
    create: vi.fn(),
    findMany: vi.fn(),
    findFirst: vi.fn(),
    findUniqueOrThrow: vi.fn(),
    updateMany: vi.fn(),
  },
  eventAttendee: {
    upsert: vi.fn(),
    findUnique: vi.fn(),
    findMany: vi.fn(),
    deleteMany: vi.fn(),
  },
  eventException: {
    upsert: vi.fn(),
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
          include: { attendees: true, exceptions: true },
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
          include: { attendees: true, exceptions: true },
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
        include: { attendees: true, exceptions: true },
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
});
