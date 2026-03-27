import { BadRequestException } from '@nestjs/common';
import { MembershipRole, RSVPStatus } from '@prisma/client';
import { vi } from 'vitest';
import { PlanningService } from '@libs/planning';
import { PlanningController } from './planning.controller';
import { QueryEventsDto } from './dto/query-events.dto';

// ── Mocks ──────────────────────────────────────────────────────────────────────

vi.mock('@libs/planning', () => ({
  PlanningService: class MockPlanningService {},
}));

const mockService = {
  createEvent: vi.fn(),
  listEvents: vi.fn(),
  getEvent: vi.fn(),
  updateEvent: vi.fn(),
  deleteEvent: vi.fn(),
  rsvp: vi.fn(),
  createException: vi.fn(),
} as unknown as PlanningService;

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeReq(role: MembershipRole = MembershipRole.MEMBER): any {
  return { membership: { role } };
}

const ORG_ID = 'org-1';
const EVENT_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const USER_ID = 'user-1';

const baseEvent = {
  id: EVENT_ID,
  orgId: ORG_ID,
  title: 'Test Event',
  version: 1,
  attendees: [],
  exceptions: [],
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('PlanningController', () => {
  let controller: PlanningController;

  beforeEach(() => {
    vi.clearAllMocks();
    controller = new PlanningController(mockService);
  });

  // ── POST / — create ─────────────────────────────────────────────────────────

  describe('create()', () => {
    const dto = {
      title: 'Sprint Planning',
      start: '2026-04-01T09:00:00Z',
      end: '2026-04-01T10:00:00Z',
      eventTimezone: 'UTC',
    };

    it('delegates to planningService.createEvent and returns the result', async () => {
      mockService.createEvent = vi.fn().mockResolvedValue(baseEvent);

      const result = await controller.create(ORG_ID, dto as any, USER_ID);

      expect(result).toBe(baseEvent);
      expect(mockService.createEvent).toHaveBeenCalledWith(
        ORG_ID,
        USER_ID,
        expect.objectContaining({ title: 'Sprint Planning' }),
      );
    });

    it('forwards optional fields (rrule, attendeeIds) to the service', async () => {
      mockService.createEvent = vi.fn().mockResolvedValue(baseEvent);
      const withOptionals = {
        ...dto,
        rrule: 'FREQ=WEEKLY;BYDAY=MO',
        attendeeIds: ['user-2'],
      };

      await controller.create(ORG_ID, withOptionals as any, USER_ID);

      expect(mockService.createEvent).toHaveBeenCalledWith(
        ORG_ID,
        USER_ID,
        expect.objectContaining({
          rrule: 'FREQ=WEEKLY;BYDAY=MO',
          attendeeIds: ['user-2'],
        }),
      );
    });
  });

  // ── GET / — list ────────────────────────────────────────────────────────────

  describe('list()', () => {
    it('returns expanded occurrences for a valid range', async () => {
      const occurrences = [{ eventId: EVENT_ID, startUtc: new Date() }];
      mockService.listEvents = vi.fn().mockResolvedValue(occurrences);

      const query: QueryEventsDto = {
        from: '2026-04-01T00:00:00Z',
        to: '2026-04-30T23:59:59Z',
      };
      const result = await controller.list(ORG_ID, query);

      expect(result).toBe(occurrences);
      expect(mockService.listEvents).toHaveBeenCalledWith(
        ORG_ID,
        new Date('2026-04-01T00:00:00Z'),
        new Date('2026-04-30T23:59:59Z'),
      );
    });

    it('throws BadRequestException when to <= from', async () => {
      await expect(
        controller.list(ORG_ID, {
          from: '2026-04-30T00:00:00Z',
          to: '2026-04-01T00:00:00Z',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when range exceeds 365 days', async () => {
      await expect(
        controller.list(ORG_ID, {
          from: '2025-01-01T00:00:00Z',
          to: '2026-06-01T00:00:00Z',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when from or to is not a valid ISO 8601 date', async () => {
      await expect(
        controller.list(ORG_ID, {
          from: 'not-a-date',
          to: '2026-04-30T23:59:59Z',
        }),
      ).rejects.toThrow(BadRequestException);

      await expect(
        controller.list(ORG_ID, {
          from: '2026-04-01T00:00:00Z',
          to: 'not-a-date',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ── GET /:id — findOne ──────────────────────────────────────────────────────

  describe('findOne()', () => {
    it('returns the event from the service', async () => {
      mockService.getEvent = vi.fn().mockResolvedValue(baseEvent);

      const result = await controller.findOne(ORG_ID, EVENT_ID);

      expect(result).toBe(baseEvent);
      expect(mockService.getEvent).toHaveBeenCalledWith(ORG_ID, EVENT_ID);
    });
  });

  // ── PATCH /:id — update ─────────────────────────────────────────────────────

  describe('update()', () => {
    const dto = { version: 1, title: 'Updated' };

    it('delegates to planningService.updateEvent with role from membership', async () => {
      const updated = { ...baseEvent, title: 'Updated', version: 2 };
      mockService.updateEvent = vi.fn().mockResolvedValue(updated);

      const result = await controller.update(
        ORG_ID,
        EVENT_ID,
        dto as any,
        USER_ID,
        makeReq(MembershipRole.ADMIN),
      );

      expect(result).toBe(updated);
      expect(mockService.updateEvent).toHaveBeenCalledWith(
        ORG_ID,
        EVENT_ID,
        dto,
        USER_ID,
        MembershipRole.ADMIN,
      );
    });

    it('passes the membership role from the request', async () => {
      mockService.updateEvent = vi.fn().mockResolvedValue(baseEvent);

      await controller.update(
        ORG_ID,
        EVENT_ID,
        dto as any,
        USER_ID,
        makeReq(MembershipRole.OWNER),
      );

      expect(mockService.updateEvent).toHaveBeenCalledWith(
        ORG_ID,
        EVENT_ID,
        dto,
        USER_ID,
        MembershipRole.OWNER,
      );
    });
  });

  // ── DELETE /:id — remove ────────────────────────────────────────────────────

  describe('remove()', () => {
    it('calls deleteEvent and returns a success message', async () => {
      mockService.deleteEvent = vi.fn().mockResolvedValue(undefined);

      const result = await controller.remove(
        ORG_ID,
        EVENT_ID,
        USER_ID,
        makeReq(MembershipRole.MEMBER),
      );

      expect(result).toEqual({ message: 'Event deleted successfully' });
      expect(mockService.deleteEvent).toHaveBeenCalledWith(
        ORG_ID,
        EVENT_ID,
        USER_ID,
        MembershipRole.MEMBER,
      );
    });
  });

  // ── POST /:id/rsvp ──────────────────────────────────────────────────────────

  describe('rsvp()', () => {
    it('delegates to planningService.rsvp and returns the attendee record', async () => {
      const attendee = {
        eventId: EVENT_ID,
        userId: USER_ID,
        status: RSVPStatus.YES,
      };
      mockService.rsvp = vi.fn().mockResolvedValue(attendee);

      const result = await controller.rsvp(
        ORG_ID,
        EVENT_ID,
        { status: RSVPStatus.YES },
        USER_ID,
      );

      expect(result).toBe(attendee);
      expect(mockService.rsvp).toHaveBeenCalledWith(
        ORG_ID,
        EVENT_ID,
        USER_ID,
        RSVPStatus.YES,
      );
    });

    it('passes through MAYBE and NO statuses unchanged', async () => {
      mockService.rsvp = vi.fn().mockResolvedValue({});

      await controller.rsvp(
        ORG_ID,
        EVENT_ID,
        { status: RSVPStatus.NO },
        USER_ID,
      );
      expect(mockService.rsvp).toHaveBeenCalledWith(
        ORG_ID,
        EVENT_ID,
        USER_ID,
        RSVPStatus.NO,
      );

      await controller.rsvp(
        ORG_ID,
        EVENT_ID,
        { status: RSVPStatus.MAYBE },
        USER_ID,
      );
      expect(mockService.rsvp).toHaveBeenCalledWith(
        ORG_ID,
        EVENT_ID,
        USER_ID,
        RSVPStatus.MAYBE,
      );
    });
  });

  // ── POST /:id/exceptions ────────────────────────────────────────────────────

  describe('createException()', () => {
    const exceptionDto = {
      originalStartUtc: '2026-04-06T09:00:00Z',
      isCancelled: true,
    };

    it('delegates to planningService.createException with role from membership', async () => {
      const exception = { id: 'ex-1', eventId: EVENT_ID };
      mockService.createException = vi.fn().mockResolvedValue(exception);

      const result = await controller.createException(
        ORG_ID,
        EVENT_ID,
        exceptionDto as any,
        USER_ID,
        makeReq(MembershipRole.MEMBER),
      );

      expect(result).toBe(exception);
      expect(mockService.createException).toHaveBeenCalledWith(
        ORG_ID,
        EVENT_ID,
        exceptionDto,
        USER_ID,
        MembershipRole.MEMBER,
      );
    });

    it('forwards optional override fields to the service', async () => {
      mockService.createException = vi.fn().mockResolvedValue({});
      const withOverrides = {
        originalStartUtc: '2026-04-06T09:00:00Z',
        startUtc: '2026-04-06T14:00:00Z',
        title: 'Rescheduled',
        location: 'Room B',
      };

      await controller.createException(
        ORG_ID,
        EVENT_ID,
        withOverrides as any,
        USER_ID,
        makeReq(),
      );

      expect(mockService.createException).toHaveBeenCalledWith(
        ORG_ID,
        EVENT_ID,
        withOverrides,
        USER_ID,
        MembershipRole.MEMBER,
      );
    });
  });
});
