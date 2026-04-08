import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import {
  ForbiddenException,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { MembershipRole, RSVPStatus } from '@libs/prisma-business';
import { PlanningService } from './planning.service';
import { PlanningRepository } from '../../infrastructure/repositories/planning.repository';
import { RecurrenceService } from './recurrence.service';
import { ActivityLogService } from '@libs/activity-log';
import { LegalAuditService } from '@libs/legal-audit';
import { NotificationsService } from '@libs/notifications';
import { UsersService } from '@libs/users';

const makeEvent = (overrides = {}) => ({
  id: 'event-1',
  orgId: 'org-1',
  createdByUserId: 'user-creator',
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
  attendees: [],
  exceptions: [],
  ...overrides,
});

describe('PlanningService', () => {
  let service: PlanningService;
  let repo: {
    createEvent: ReturnType<typeof vi.fn>;
    findEventsByRange: ReturnType<typeof vi.fn>;
    findConflictCandidates: ReturnType<typeof vi.fn>;
    findEventById: ReturnType<typeof vi.fn>;
    updateEvent: ReturnType<typeof vi.fn>;
    softDeleteEvent: ReturnType<typeof vi.fn>;
    upsertAttendee: ReturnType<typeof vi.fn>;
    findAttendee: ReturnType<typeof vi.fn>;
    findAttendees: ReturnType<typeof vi.fn>;
    upsertException: ReturnType<typeof vi.fn>;
    deleteAttendeesExcluding: ReturnType<typeof vi.fn>;
    splitSeries: ReturnType<typeof vi.fn>;
    upsertOccurrenceAttendee: ReturnType<typeof vi.fn>;
    ensureAttendee: ReturnType<typeof vi.fn>;
  };
  let activityLog: { logActivity: ReturnType<typeof vi.fn> };
  let legalAudit: { recordEvent: ReturnType<typeof vi.fn> };
  let notificationsService: { notifyUser: ReturnType<typeof vi.fn> };
  let usersService: { findById: ReturnType<typeof vi.fn> };
  let recurrenceService: {
    expand: ReturnType<typeof vi.fn>;
    isValidRrule: ReturnType<typeof vi.fn>;
    truncateRrule: ReturnType<typeof vi.fn>;
    stripCountAndUntil: ReturnType<typeof vi.fn>;
    getLastOccurrenceDate: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    repo = {
      createEvent: vi.fn(),
      findEventsByRange: vi.fn(),
      findConflictCandidates: vi.fn(),
      findEventById: vi.fn(),
      updateEvent: vi.fn(),
      softDeleteEvent: vi.fn(),
      upsertAttendee: vi.fn(),
      findAttendee: vi.fn(),
      findAttendees: vi.fn(),
      upsertException: vi.fn(),
      deleteAttendeesExcluding: vi.fn(),
      splitSeries: vi.fn(),
      upsertOccurrenceAttendee: vi.fn(),
      ensureAttendee: vi.fn(),
    };
    activityLog = { logActivity: vi.fn() };
    legalAudit = { recordEvent: vi.fn() };
    notificationsService = { notifyUser: vi.fn().mockResolvedValue({}) };
    usersService = { findById: vi.fn() };
    recurrenceService = {
      expand: vi.fn().mockReturnValue([]),
      isValidRrule: vi.fn().mockReturnValue(true),
      truncateRrule: vi
        .fn()
        .mockReturnValue('FREQ=DAILY;UNTIL=20260405T235959Z'),
      stripCountAndUntil: vi.fn().mockReturnValue('FREQ=DAILY'),
      getLastOccurrenceDate: vi
        .fn()
        .mockReturnValue(new Date('2026-04-10T09:00:00Z')),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PlanningService,
        { provide: PlanningRepository, useValue: repo },
        { provide: RecurrenceService, useValue: recurrenceService },
        { provide: ActivityLogService, useValue: activityLog },
        { provide: LegalAuditService, useValue: legalAudit },
        { provide: NotificationsService, useValue: notificationsService },
        { provide: UsersService, useValue: usersService },
      ],
    }).compile();

    service = module.get(PlanningService);
  });

  describe('createEvent', () => {
    it('creates a single event and adds creator as YES attendee', async () => {
      const event = makeEvent();
      repo.createEvent.mockResolvedValue(event);
      repo.upsertAttendee.mockResolvedValue({});
      repo.findAttendees.mockResolvedValue([]);

      const result = await service.createEvent('org-1', 'user-creator', {
        title: 'Test Event',
        start: '2026-01-05T10:00:00Z',
        end: '2026-01-05T11:00:00Z',
        eventTimezone: 'UTC',
      });

      expect(repo.createEvent).toHaveBeenCalledOnce();
      expect(repo.upsertAttendee).toHaveBeenCalledWith(
        'event-1',
        'user-creator',
        RSVPStatus.YES,
      );
      expect(result.id).toBe('event-1');
    });

    it('throws BadRequestException when end is before start', async () => {
      await expect(
        service.createEvent('org-1', 'user-1', {
          title: 'Bad',
          start: '2026-01-05T11:00:00Z',
          end: '2026-01-05T10:00:00Z',
          eventTimezone: 'UTC',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException for invalid RRULE', async () => {
      recurrenceService.isValidRrule.mockReturnValue(false);

      await expect(
        service.createEvent('org-1', 'user-1', {
          title: 'Bad RRULE',
          start: '2026-01-05T10:00:00Z',
          end: '2026-01-05T11:00:00Z',
          eventTimezone: 'UTC',
          rrule: 'INVALID',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('passes rruleUntilUtc as a Date to the repository when provided', async () => {
      const event = makeEvent();
      repo.createEvent.mockResolvedValue(event);
      repo.upsertAttendee.mockResolvedValue({});
      repo.findAttendees.mockResolvedValue([]);

      await service.createEvent('org-1', 'user-creator', {
        title: 'Recurring',
        start: '2026-01-05T10:00:00Z',
        end: '2026-01-05T11:00:00Z',
        eventTimezone: 'UTC',
        rrule: 'FREQ=WEEKLY',
        rruleUntilUtc: '2026-06-01T00:00:00Z',
      });

      expect(repo.createEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          rruleUntilUtc: new Date('2026-06-01T00:00:00Z'),
        }),
      );
    });

    it('fires activity log and legal audit (fire-and-forget)', async () => {
      const event = makeEvent();
      repo.createEvent.mockResolvedValue(event);
      repo.upsertAttendee.mockResolvedValue({});
      repo.findAttendees.mockResolvedValue([]);

      await service.createEvent('org-1', 'user-creator', {
        title: 'Test',
        start: '2026-01-05T10:00:00Z',
        end: '2026-01-05T11:00:00Z',
        eventTimezone: 'UTC',
      });

      expect(activityLog.logActivity).toHaveBeenCalledOnce();
      expect(legalAudit.recordEvent).toHaveBeenCalledOnce();
    });
  });

  describe('getEvent', () => {
    it('returns the event when found', async () => {
      repo.findEventById.mockResolvedValue(makeEvent());
      const result = await service.getEvent('org-1', 'event-1');
      expect(result.id).toBe('event-1');
    });

    it('throws NotFoundException when event does not exist', async () => {
      repo.findEventById.mockResolvedValue(null);
      await expect(service.getEvent('org-1', 'missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('deleteEvent', () => {
    it('allows creator (MEMBER) to delete their own event', async () => {
      repo.findEventById.mockResolvedValue(makeEvent());
      repo.softDeleteEvent.mockResolvedValue(undefined);

      await service.deleteEvent(
        'org-1',
        'event-1',
        'user-creator',
        MembershipRole.MEMBER,
      );

      expect(repo.softDeleteEvent).toHaveBeenCalledWith('event-1', 'org-1');
    });

    it('allows ADMIN to delete any event', async () => {
      repo.findEventById.mockResolvedValue(
        makeEvent({ createdByUserId: 'someone-else' }),
      );
      repo.softDeleteEvent.mockResolvedValue(undefined);

      await expect(
        service.deleteEvent(
          'org-1',
          'event-1',
          'admin-user',
          MembershipRole.ADMIN,
        ),
      ).resolves.toBeUndefined();
    });

    it('forbids MEMBER to delete another users event', async () => {
      repo.findEventById.mockResolvedValue(
        makeEvent({ createdByUserId: 'someone-else' }),
      );

      await expect(
        service.deleteEvent(
          'org-1',
          'event-1',
          'other-user',
          MembershipRole.MEMBER,
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws NotFoundException for missing event', async () => {
      repo.findEventById.mockResolvedValue(null);
      await expect(
        service.deleteEvent('org-1', 'event-1', 'user-1', MembershipRole.OWNER),
      ).rejects.toThrow(NotFoundException);
    });

    it('sends cancel notifications to non-actor attendees', async () => {
      const attendee = { userId: 'user-2' };
      repo.findEventById.mockResolvedValue(
        makeEvent({ attendees: [attendee] }),
      );
      repo.softDeleteEvent.mockResolvedValue(undefined);

      await service.deleteEvent(
        'org-1',
        'event-1',
        'user-creator',
        MembershipRole.OWNER,
      );

      await new Promise((r) => setImmediate(r));
      expect(notificationsService.notifyUser).toHaveBeenCalledWith(
        'user-2',
        'org-1',
        expect.objectContaining({ type: 'event.cancelled' }),
      );
    });

    it('does NOT send cancel notifications to the actor', async () => {
      const attendee = { userId: 'user-creator' };
      repo.findEventById.mockResolvedValue(
        makeEvent({ attendees: [attendee] }),
      );
      repo.softDeleteEvent.mockResolvedValue(undefined);

      await service.deleteEvent(
        'org-1',
        'event-1',
        'user-creator',
        MembershipRole.OWNER,
      );

      await new Promise((r) => setImmediate(r));
      expect(notificationsService.notifyUser).not.toHaveBeenCalled();
    });

    it('logs error when sendCancelNotifications rejects during deleteEvent', async () => {
      const attendee = { userId: 'user-2' };
      repo.findEventById.mockResolvedValue(
        makeEvent({ attendees: [attendee] }),
      );
      repo.softDeleteEvent.mockResolvedValue(undefined);
      notificationsService.notifyUser.mockImplementation(() => {
        throw new Error('sync notify failure');
      });

      await service.deleteEvent(
        'org-1',
        'event-1',
        'user-creator',
        MembershipRole.OWNER,
      );

      // Fire-and-forget — should not propagate the error
      await new Promise((r) => setImmediate(r));
      expect(notificationsService.notifyUser).toHaveBeenCalledWith(
        'user-2',
        'org-1',
        expect.objectContaining({ type: 'event.cancelled' }),
      );
    });
  });

  describe('rsvp', () => {
    it('upserts the attendee record', async () => {
      repo.findEventById.mockResolvedValue(makeEvent());
      repo.upsertAttendee.mockResolvedValue({
        eventId: 'event-1',
        userId: 'user-2',
        status: RSVPStatus.YES,
      });

      const result = await service.rsvp(
        'org-1',
        'event-1',
        'user-2',
        RSVPStatus.YES,
      );

      expect(repo.upsertAttendee).toHaveBeenCalledWith(
        'event-1',
        'user-2',
        RSVPStatus.YES,
      );
      expect(result.status).toBe(RSVPStatus.YES);
    });

    it('notifies the creator when a different user RSVPs', async () => {
      repo.findEventById.mockResolvedValue(
        makeEvent({ createdByUserId: 'creator' }),
      );
      repo.upsertAttendee.mockResolvedValue({});
      usersService.findById.mockResolvedValue({
        firstName: 'Alex',
        lastName: 'Rossi',
        email: 'alex@example.com',
      });

      await service.rsvp('org-1', 'event-1', 'other-user', RSVPStatus.NO);

      // Notification is fire-and-forget, so we wait a tick
      await new Promise((r) => setImmediate(r));
      expect(notificationsService.notifyUser).toHaveBeenCalledWith(
        'creator',
        'org-1',
        expect.objectContaining({
          type: 'event.rsvp',
          body: 'Alex Rossi responded "NO" to "Test Event"',
        }),
      );
    });

    it('does NOT notify the creator when they RSVP to their own event', async () => {
      repo.findEventById.mockResolvedValue(
        makeEvent({ createdByUserId: 'user-creator' }),
      );
      repo.upsertAttendee.mockResolvedValue({});

      await service.rsvp('org-1', 'event-1', 'user-creator', RSVPStatus.YES);

      await new Promise((r) => setImmediate(r));
      expect(notificationsService.notifyUser).not.toHaveBeenCalled();
    });

    it('falls back to userId in display name when user is not found', async () => {
      repo.findEventById.mockResolvedValue(
        makeEvent({ createdByUserId: 'creator' }),
      );
      repo.upsertAttendee.mockResolvedValue({});
      usersService.findById.mockResolvedValue(null);

      await service.rsvp('org-1', 'event-1', 'other-user', RSVPStatus.YES);

      await new Promise((r) => setImmediate(r));
      expect(notificationsService.notifyUser).toHaveBeenCalledWith(
        'creator',
        'org-1',
        expect.objectContaining({
          body: 'other-user responded "YES" to "Test Event"',
        }),
      );
    });

    it('falls back to userId in display name when findById throws', async () => {
      repo.findEventById.mockResolvedValue(
        makeEvent({ createdByUserId: 'creator' }),
      );
      repo.upsertAttendee.mockResolvedValue({});
      usersService.findById.mockRejectedValue(new Error('DB error'));

      await service.rsvp('org-1', 'event-1', 'other-user', RSVPStatus.NO);

      await new Promise((r) => setImmediate(r));
      expect(notificationsService.notifyUser).toHaveBeenCalledWith(
        'creator',
        'org-1',
        expect.objectContaining({
          body: 'other-user responded "NO" to "Test Event"',
        }),
      );
    });

    it('logs error when RSVP notification fails', async () => {
      repo.findEventById.mockResolvedValue(
        makeEvent({ createdByUserId: 'creator' }),
      );
      repo.upsertAttendee.mockResolvedValue({});
      usersService.findById.mockResolvedValue({
        firstName: 'Alex',
        lastName: null,
        email: 'alex@example.com',
      });
      notificationsService.notifyUser.mockRejectedValue(
        new Error('notification error'),
      );

      await service.rsvp('org-1', 'event-1', 'other-user', RSVPStatus.YES);

      // Fire-and-forget — just verify it doesn't throw
      await new Promise((r) => setImmediate(r));
      expect(notificationsService.notifyUser).toHaveBeenCalledWith(
        'creator',
        'org-1',
        expect.objectContaining({ type: 'event.rsvp' }),
      );
    });

    it('per-occurrence: calls upsertOccurrenceAttendee and ensureAttendee when originalStartUtc is provided on a recurring event', async () => {
      const occStart = '2026-01-12T10:00:00.000Z';
      const masterAttendee = {
        id: 'att-1',
        eventId: 'event-1',
        userId: 'user-2',
        status: RSVPStatus.YES,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      repo.findEventById.mockResolvedValue(
        makeEvent({ rrule: 'FREQ=WEEKLY;BYDAY=MO' }),
      );
      repo.upsertOccurrenceAttendee.mockResolvedValue(undefined);
      repo.ensureAttendee.mockResolvedValue(masterAttendee);

      const result = await service.rsvp(
        'org-1',
        'event-1',
        'user-2',
        RSVPStatus.NO,
        occStart,
      );

      expect(repo.upsertOccurrenceAttendee).toHaveBeenCalledWith(
        'event-1',
        'user-2',
        new Date(occStart),
        RSVPStatus.NO,
      );
      expect(repo.ensureAttendee).toHaveBeenCalledWith(
        'event-1',
        'user-2',
        RSVPStatus.NO,
      );
      expect(repo.upsertAttendee).not.toHaveBeenCalled();
      expect(result).toEqual(masterAttendee);
    });

    it('per-occurrence: falls back to series-wide upsert when event has no rrule', async () => {
      const occStart = '2026-01-05T10:00:00.000Z';
      const masterAttendee = {
        id: 'att-1',
        eventId: 'event-1',
        userId: 'user-2',
        status: RSVPStatus.YES,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      repo.findEventById.mockResolvedValue(makeEvent({ rrule: null }));
      repo.upsertAttendee.mockResolvedValue(masterAttendee);

      await service.rsvp(
        'org-1',
        'event-1',
        'user-2',
        RSVPStatus.YES,
        occStart,
      );

      expect(repo.upsertOccurrenceAttendee).not.toHaveBeenCalled();
      expect(repo.upsertAttendee).toHaveBeenCalledWith(
        'event-1',
        'user-2',
        RSVPStatus.YES,
      );
    });

    it('per-occurrence: throws BadRequestException when originalStartUtc is not a valid date', async () => {
      repo.findEventById.mockResolvedValue(
        makeEvent({ rrule: 'FREQ=WEEKLY;BYDAY=MO' }),
      );

      await expect(
        service.rsvp(
          'org-1',
          'event-1',
          'user-2',
          RSVPStatus.YES,
          'not-a-date',
        ),
      ).rejects.toThrow(BadRequestException);

      expect(repo.upsertOccurrenceAttendee).not.toHaveBeenCalled();
    });
  });

  describe('createException', () => {
    it('throws BadRequestException for non-recurring event', async () => {
      repo.findEventById.mockResolvedValue(makeEvent({ rrule: null }));

      await expect(
        service.createException(
          'org-1',
          'event-1',
          { originalStartUtc: '2026-01-05T10:00:00Z', isCancelled: true },
          'user-creator',
          MembershipRole.MEMBER,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('upserts the exception for a recurring event', async () => {
      repo.findEventById.mockResolvedValue(
        makeEvent({ rrule: 'FREQ=WEEKLY;BYDAY=MO' }),
      );
      repo.upsertException.mockResolvedValue({ id: 'ex-1' });

      const result = await service.createException(
        'org-1',
        'event-1',
        { originalStartUtc: '2026-01-12T10:00:00Z', isCancelled: true },
        'user-creator',
        MembershipRole.MEMBER,
      );

      expect(repo.upsertException).toHaveBeenCalledOnce();
      expect(result.id).toBe('ex-1');
    });

    it('throws ForbiddenException when MEMBER tries to modify another user exception', async () => {
      repo.findEventById.mockResolvedValue(
        makeEvent({
          rrule: 'FREQ=WEEKLY;BYDAY=MO',
          createdByUserId: 'someone-else',
        }),
      );

      await expect(
        service.createException(
          'org-1',
          'event-1',
          { originalStartUtc: '2026-01-12T10:00:00Z' },
          'other-user',
          MembershipRole.MEMBER,
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws NotFoundException when event is missing', async () => {
      repo.findEventById.mockResolvedValue(null);

      await expect(
        service.createException(
          'org-1',
          'missing',
          { originalStartUtc: '2026-01-12T10:00:00Z' },
          'user-1',
          MembershipRole.ADMIN,
        ),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('createEvent — with invited attendees', () => {
    it('adds each invited attendee as PENDING and skips the creator', async () => {
      const event = makeEvent();
      repo.createEvent.mockResolvedValue(event);
      repo.upsertAttendee.mockResolvedValue({});
      repo.findAttendees.mockResolvedValue([]);

      await service.createEvent('org-1', 'user-creator', {
        title: 'Team Sync',
        start: '2026-01-05T10:00:00Z',
        end: '2026-01-05T11:00:00Z',
        eventTimezone: 'UTC',
        attendeeIds: ['user-creator', 'user-2', 'user-3'],
      });

      // creator → YES; user-2 and user-3 → PENDING (creator not duplicated as PENDING)
      expect(repo.upsertAttendee).toHaveBeenCalledWith(
        'event-1',
        'user-creator',
        RSVPStatus.YES,
      );
      expect(repo.upsertAttendee).toHaveBeenCalledWith(
        'event-1',
        'user-2',
        RSVPStatus.PENDING,
      );
      expect(repo.upsertAttendee).toHaveBeenCalledWith(
        'event-1',
        'user-3',
        RSVPStatus.PENDING,
      );
    });

    it('sends invite notifications to non-creator attendees', async () => {
      const event = makeEvent();
      repo.createEvent.mockResolvedValue(event);
      repo.upsertAttendee.mockResolvedValue({});
      repo.findAttendees.mockResolvedValue([]);

      await service.createEvent('org-1', 'user-creator', {
        title: 'Team Sync',
        start: '2026-01-05T10:00:00Z',
        end: '2026-01-05T11:00:00Z',
        eventTimezone: 'UTC',
        attendeeIds: ['user-creator', 'user-2'],
      });

      await new Promise((r) => setImmediate(r));
      expect(notificationsService.notifyUser).toHaveBeenCalledWith(
        'user-2',
        'org-1',
        expect.objectContaining({ type: 'event.invite' }),
      );
    });

    it('logs error when sendInviteNotifications rejects during createEvent', async () => {
      const event = makeEvent();
      repo.createEvent.mockResolvedValue(event);
      repo.upsertAttendee.mockResolvedValue({});
      repo.findAttendees.mockResolvedValue([]);
      // Throwing synchronously causes the allSettled map to throw before settling,
      // making sendInviteNotifications reject and the outer .catch() to run.
      notificationsService.notifyUser.mockImplementation(() => {
        throw new Error('sync notify failure');
      });

      await service.createEvent('org-1', 'user-creator', {
        title: 'Team Sync',
        start: '2026-01-05T10:00:00Z',
        end: '2026-01-05T11:00:00Z',
        eventTimezone: 'UTC',
        attendeeIds: ['user-creator', 'user-2'],
      });

      // Fire-and-forget — should not propagate the error
      await new Promise((r) => setImmediate(r));
      expect(notificationsService.notifyUser).toHaveBeenCalledWith(
        'user-2',
        'org-1',
        expect.objectContaining({ type: 'event.invite' }),
      );
    });
  });

  describe('listEvents', () => {
    it('returns an empty array when no events are in range', async () => {
      repo.findEventsByRange.mockResolvedValue([]);

      const result = await service.listEvents(
        'org-1',
        new Date('2026-01-01Z'),
        new Date('2026-01-31Z'),
      );

      expect(result).toEqual([]);
      expect(repo.findEventsByRange).toHaveBeenCalledOnce();
    });

    it('expands and sorts occurrences chronologically', async () => {
      const event1 = makeEvent({ id: 'e1' });
      const event2 = makeEvent({ id: 'e2' });
      repo.findEventsByRange.mockResolvedValue([event1, event2]);

      const occ1 = {
        eventId: 'e1',
        startUtc: new Date('2026-01-10T10:00:00Z'),
      };
      const occ2 = {
        eventId: 'e2',
        startUtc: new Date('2026-01-05T10:00:00Z'),
      };
      recurrenceService.expand
        .mockReturnValueOnce([occ1])
        .mockReturnValueOnce([occ2]);

      const result = await service.listEvents(
        'org-1',
        new Date('2026-01-01Z'),
        new Date('2026-01-31Z'),
      );

      expect(result).toHaveLength(2);
      expect(result[0].startUtc).toEqual(new Date('2026-01-05T10:00:00Z'));
      expect(result[1].startUtc).toEqual(new Date('2026-01-10T10:00:00Z'));
    });
  });

  describe('getConflicts', () => {
    it('returns only true overlaps sorted by start time', async () => {
      const event = makeEvent({ id: 'e1' });
      repo.findConflictCandidates.mockResolvedValue([event]);

      const inOverlap = {
        eventId: 'e1',
        startUtc: new Date('2026-01-05T10:15:00Z'),
        endUtc: new Date('2026-01-05T10:45:00Z'),
      };
      const noOverlap = {
        eventId: 'e1',
        startUtc: new Date('2026-01-05T11:00:00Z'),
        endUtc: new Date('2026-01-05T11:30:00Z'),
      };
      const earlyOverlap = {
        eventId: 'e1',
        startUtc: new Date('2026-01-05T10:00:00Z'),
        endUtc: new Date('2026-01-05T10:20:00Z'),
      };

      recurrenceService.expand.mockReturnValue([
        inOverlap,
        noOverlap,
        earlyOverlap,
      ]);

      const result = await service.getConflicts(
        'org-1',
        'user-1',
        new Date('2026-01-05T10:10:00Z'),
        new Date('2026-01-05T11:00:00Z'),
      );

      expect(repo.findConflictCandidates).toHaveBeenCalledWith(
        'org-1',
        'user-1',
        new Date('2026-01-05T10:10:00Z'),
        new Date('2026-01-05T11:00:00Z'),
      );
      expect(result).toHaveLength(2);
      expect(result[0].startUtc).toEqual(new Date('2026-01-05T10:00:00Z'));
      expect(result[1].startUtc).toEqual(new Date('2026-01-05T10:15:00Z'));
    });
  });

  describe('updateEvent', () => {
    const baseUpdateDto = { version: 1, title: 'Updated' };

    it('updates and returns the event', async () => {
      const event = makeEvent();
      const updated = makeEvent({ title: 'Updated', version: 2 });
      repo.findEventById.mockResolvedValue(event);
      repo.updateEvent.mockResolvedValue(updated);

      const result = await service.updateEvent(
        'org-1',
        'event-1',
        baseUpdateDto,
        'user-creator',
        MembershipRole.MEMBER,
      );

      expect(repo.updateEvent).toHaveBeenCalledOnce();
      expect(result.title).toBe('Updated');
    });

    it('throws NotFoundException when event does not exist', async () => {
      repo.findEventById.mockResolvedValue(null);

      await expect(
        service.updateEvent(
          'org-1',
          'missing',
          baseUpdateDto,
          'user-1',
          MembershipRole.ADMIN,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException when MEMBER updates another user event', async () => {
      repo.findEventById.mockResolvedValue(
        makeEvent({ createdByUserId: 'someone-else' }),
      );

      await expect(
        service.updateEvent(
          'org-1',
          'event-1',
          baseUpdateDto,
          'other-user',
          MembershipRole.MEMBER,
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws BadRequestException for invalid RRULE', async () => {
      repo.findEventById.mockResolvedValue(makeEvent());
      recurrenceService.isValidRrule.mockReturnValue(false);

      await expect(
        service.updateEvent(
          'org-1',
          'event-1',
          { version: 1, rrule: 'INVALID' },
          'user-creator',
          MembershipRole.MEMBER,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when end is before start', async () => {
      repo.findEventById.mockResolvedValue(makeEvent());

      await expect(
        service.updateEvent(
          'org-1',
          'event-1',
          {
            version: 1,
            start: '2026-01-05T11:00:00Z',
            end: '2026-01-05T10:00:00Z',
          },
          'user-creator',
          MembershipRole.MEMBER,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('fires activityLog and legalAudit', async () => {
      repo.findEventById.mockResolvedValue(makeEvent());
      repo.updateEvent.mockResolvedValue(
        makeEvent({ title: 'Updated', attendees: [] }),
      );

      await service.updateEvent(
        'org-1',
        'event-1',
        baseUpdateDto,
        'user-creator',
        MembershipRole.MEMBER,
      );

      expect(activityLog.logActivity).toHaveBeenCalledOnce();
      expect(legalAudit.recordEvent).toHaveBeenCalledOnce();
    });

    it('sends update notifications to attendees when notifyAttendees=true', async () => {
      const attendee = { userId: 'user-2' };
      repo.findEventById.mockResolvedValue(makeEvent());
      repo.updateEvent.mockResolvedValue(
        makeEvent({ title: 'Updated', attendees: [attendee] }),
      );

      await service.updateEvent(
        'org-1',
        'event-1',
        { version: 1, title: 'Updated', notifyAttendees: true },
        'user-creator',
        MembershipRole.MEMBER,
      );

      await new Promise((r) => setImmediate(r));
      expect(notificationsService.notifyUser).toHaveBeenCalledWith(
        'user-2',
        'org-1',
        expect.objectContaining({ type: 'event.updated' }),
      );
    });

    it('does not send notifications when notifyAttendees is false', async () => {
      repo.findEventById.mockResolvedValue(makeEvent());
      repo.updateEvent.mockResolvedValue(
        makeEvent({ attendees: [{ userId: 'user-2' }] }),
      );

      await service.updateEvent(
        'org-1',
        'event-1',
        { version: 1, notifyAttendees: false },
        'user-creator',
        MembershipRole.MEMBER,
      );

      await new Promise((r) => setImmediate(r));
      expect(notificationsService.notifyUser).not.toHaveBeenCalled();
    });

    it('allows OWNER to update any event', async () => {
      repo.findEventById.mockResolvedValue(
        makeEvent({ createdByUserId: 'someone-else' }),
      );
      repo.updateEvent.mockResolvedValue(makeEvent({ attendees: [] }));

      await expect(
        service.updateEvent(
          'org-1',
          'event-1',
          baseUpdateDto,
          'owner-user',
          MembershipRole.OWNER,
        ),
      ).resolves.toBeDefined();
    });

    it('syncs attendee list and sends invites to brand-new attendees', async () => {
      const event = makeEvent({ createdByUserId: 'user-creator' });
      const updatedEvent = makeEvent({
        title: 'Updated',
        attendees: [{ userId: 'user-creator' }],
      });
      const refreshedEvent = makeEvent({
        title: 'Updated',
        attendees: [{ userId: 'user-creator' }, { userId: 'user-new' }],
      });

      repo.findEventById
        .mockResolvedValueOnce(event)
        .mockResolvedValueOnce(refreshedEvent);
      repo.updateEvent.mockResolvedValue(updatedEvent);
      repo.deleteAttendeesExcluding.mockResolvedValue(undefined);
      repo.upsertAttendee.mockResolvedValue({});

      const result = await service.updateEvent(
        'org-1',
        'event-1',
        { version: 1, attendeeIds: ['user-new'] },
        'user-creator',
        MembershipRole.MEMBER,
      );

      expect(repo.deleteAttendeesExcluding).toHaveBeenCalledWith(
        'event-1',
        expect.arrayContaining(['user-creator', 'user-new']),
      );
      expect(repo.upsertAttendee).toHaveBeenCalledWith(
        'event-1',
        'user-new',
        RSVPStatus.PENDING,
      );
      expect(result.attendees).toHaveLength(2);

      await new Promise((r) => setImmediate(r));
      expect(notificationsService.notifyUser).toHaveBeenCalledWith(
        'user-new',
        'org-1',
        expect.objectContaining({ type: 'event.invite' }),
      );
    });

    it('throws NotFoundException when re-fetch after attendee sync returns null', async () => {
      repo.findEventById
        .mockResolvedValueOnce(makeEvent())
        .mockResolvedValueOnce(null);
      repo.updateEvent.mockResolvedValue(makeEvent({ attendees: [] }));
      repo.deleteAttendeesExcluding.mockResolvedValue(undefined);

      await expect(
        service.updateEvent(
          'org-1',
          'event-1',
          { version: 1, attendeeIds: [] },
          'user-creator',
          MembershipRole.MEMBER,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('logs error when sendInviteNotifications rejects during attendeeIds sync', async () => {
      const event = makeEvent({ createdByUserId: 'user-creator' });
      const updatedEvent = makeEvent({ attendees: [] });
      const refreshedEvent = makeEvent({ attendees: [] });

      repo.findEventById
        .mockResolvedValueOnce(event)
        .mockResolvedValueOnce(refreshedEvent);
      repo.updateEvent.mockResolvedValue(updatedEvent);
      repo.deleteAttendeesExcluding.mockResolvedValue(undefined);
      notificationsService.notifyUser.mockImplementation(() => {
        throw new Error('sync notify failure');
      });

      await service.updateEvent(
        'org-1',
        'event-1',
        { version: 1, attendeeIds: ['user-new'] },
        'user-creator',
        MembershipRole.MEMBER,
      );

      // Fire-and-forget — should not propagate the error
      await new Promise((r) => setImmediate(r));
      expect(notificationsService.notifyUser).toHaveBeenCalledWith(
        'user-new',
        'org-1',
        expect.objectContaining({ type: 'event.invite' }),
      );
    });

    it('logs error when sendUpdateNotifications rejects during notifyAttendees', async () => {
      const attendee = { userId: 'user-2' };
      repo.findEventById.mockResolvedValue(makeEvent());
      repo.updateEvent.mockResolvedValue(
        makeEvent({ title: 'Updated', attendees: [attendee] }),
      );
      notificationsService.notifyUser.mockImplementation(() => {
        throw new Error('sync notify failure');
      });

      await service.updateEvent(
        'org-1',
        'event-1',
        { version: 1, title: 'Updated', notifyAttendees: true },
        'user-creator',
        MembershipRole.MEMBER,
      );

      // Fire-and-forget — should not propagate the error
      await new Promise((r) => setImmediate(r));
      expect(notificationsService.notifyUser).toHaveBeenCalledWith(
        'user-2',
        'org-1',
        expect.objectContaining({ type: 'event.updated' }),
      );
    });

    it('skips attendee upsert when attendee is already in the list', async () => {
      const existingAttendee = { userId: 'user-existing' };
      const event = makeEvent({ createdByUserId: 'user-creator' });
      const updatedEvent = makeEvent({
        attendees: [{ userId: 'user-creator' }, existingAttendee],
      });
      const refreshedEvent = makeEvent({
        attendees: [{ userId: 'user-creator' }, existingAttendee],
      });

      repo.findEventById
        .mockResolvedValueOnce(event)
        .mockResolvedValueOnce(refreshedEvent);
      repo.updateEvent.mockResolvedValue(updatedEvent);
      repo.deleteAttendeesExcluding.mockResolvedValue(undefined);
      repo.upsertAttendee.mockResolvedValue({});

      await service.updateEvent(
        'org-1',
        'event-1',
        { version: 1, attendeeIds: ['user-existing'] },
        'user-creator',
        MembershipRole.MEMBER,
      );

      // user-existing is already present → no upsertAttendee for them
      expect(repo.upsertAttendee).not.toHaveBeenCalledWith(
        'event-1',
        'user-existing',
        RSVPStatus.PENDING,
      );
    });
  });

  describe('rsvp', () => {
    it('throws NotFoundException when event does not exist', async () => {
      repo.findEventById.mockResolvedValue(null);

      await expect(
        service.rsvp('org-1', 'missing', 'user-1', RSVPStatus.YES),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ── splitSeries ───────────────────────────────────────────────────────────

  describe('splitSeries', () => {
    const SPLIT_POINT = '2026-01-07T10:00:00Z';
    const ATTENDEE_A = {
      id: 'att-1',
      eventId: 'event-1',
      userId: 'user-a',
      status: RSVPStatus.YES,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const ATTENDEE_B = {
      id: 'att-2',
      eventId: 'event-1',
      userId: 'user-b',
      status: RSVPStatus.PENDING,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const recurringEvent = makeEvent({
      rrule: 'FREQ=DAILY;COUNT=10',
      rruleUntilUtc: null,
      attendees: [ATTENDEE_A, ATTENDEE_B],
    });

    const newTailEvent = makeEvent({
      id: 'event-tail',
      rrule: 'FREQ=DAILY',
      startUtc: new Date(SPLIT_POINT),
      endUtc: new Date('2026-01-07T11:00:00Z'),
      attendees: [
        { ...ATTENDEE_A, eventId: 'event-tail' },
        { ...ATTENDEE_B, eventId: 'event-tail' },
      ],
      exceptions: [],
    });

    beforeEach(() => {
      repo.findEventById.mockResolvedValue(recurringEvent);
      recurrenceService.expand.mockReturnValue([
        {
          eventId: 'event-1',
          originalStartUtc: new Date(SPLIT_POINT),
          startUtc: new Date(SPLIT_POINT),
          endUtc: new Date('2026-01-07T11:00:00Z'),
          title: 'Test Event',
          description: null,
          location: null,
          isAllDay: false,
          eventTimezone: 'UTC',
          rrule: 'FREQ=DAILY;COUNT=10',
          isRecurring: true,
          isException: false,
          isCancelled: false,
          createdByUserId: 'user-creator',
          orgId: 'org-1',
          version: 1,
          attendees: [],
        },
      ]);
      repo.splitSeries.mockResolvedValue({
        updatedOriginal: recurringEvent,
        newEvent: newTailEvent,
      });
    });

    it('returns the new tail event on success', async () => {
      const result = await service.splitSeries(
        'org-1',
        'event-1',
        { originalStartUtc: SPLIT_POINT, version: 1 },
        'user-creator',
        MembershipRole.MEMBER,
      );

      expect(result.id).toBe('event-tail');
      expect(repo.splitSeries).toHaveBeenCalledOnce();
    });

    it('throws NotFoundException when event does not exist', async () => {
      repo.findEventById.mockResolvedValue(null);

      await expect(
        service.splitSeries(
          'org-1',
          'missing',
          { originalStartUtc: SPLIT_POINT, version: 1 },
          'user-creator',
          MembershipRole.MEMBER,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException for a non-recurring event', async () => {
      repo.findEventById.mockResolvedValue(makeEvent({ rrule: null }));

      await expect(
        service.splitSeries(
          'org-1',
          'event-1',
          { originalStartUtc: SPLIT_POINT, version: 1 },
          'user-creator',
          MembershipRole.MEMBER,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when originalStartUtc is not a valid occurrence', async () => {
      // expand returns empty → occurrence does not exist.
      recurrenceService.expand.mockReturnValue([]);

      await expect(
        service.splitSeries(
          'org-1',
          'event-1',
          { originalStartUtc: SPLIT_POINT, version: 1 },
          'user-creator',
          MembershipRole.MEMBER,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException for a malformed originalStartUtc', async () => {
      await expect(
        service.splitSeries(
          'org-1',
          'event-1',
          { originalStartUtc: 'not-a-date', version: 1 },
          'user-creator',
          MembershipRole.MEMBER,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws ConflictException on version mismatch', async () => {
      await expect(
        service.splitSeries(
          'org-1',
          'event-1',
          { originalStartUtc: SPLIT_POINT, version: 99 },
          'user-creator',
          MembershipRole.MEMBER,
        ),
      ).rejects.toThrow(ConflictException);
    });

    it("throws ForbiddenException when MEMBER tries to split another user's event", async () => {
      await expect(
        service.splitSeries(
          'org-1',
          'event-1',
          { originalStartUtc: SPLIT_POINT, version: 1 },
          'user-other',
          MembershipRole.MEMBER,
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('allows ADMIN to split an event they did not create', async () => {
      const result = await service.splitSeries(
        'org-1',
        'event-1',
        { originalStartUtc: SPLIT_POINT, version: 1 },
        'user-admin',
        MembershipRole.ADMIN,
      );

      expect(result.id).toBe('event-tail');
    });

    it('passes title override to repo.splitSeries', async () => {
      await service.splitSeries(
        'org-1',
        'event-1',
        { originalStartUtc: SPLIT_POINT, version: 1, title: 'New title' },
        'user-creator',
        MembershipRole.MEMBER,
      );

      expect(repo.splitSeries).toHaveBeenCalledWith(
        expect.objectContaining({
          overrides: expect.objectContaining({ title: 'New title' }),
        }),
      );
    });

    it('sends invite notifications to attendees (excluding actor)', async () => {
      await service.splitSeries(
        'org-1',
        'event-1',
        { originalStartUtc: SPLIT_POINT, version: 1 },
        'user-creator', // actor is the event creator (also an attendee via ATTENDEE_A? use user-b perspective)
        MembershipRole.MEMBER,
      );

      // user-b (non-actor attendee) should receive a notification.
      await new Promise((r) => setTimeout(r, 0)); // flush micro-task queue
      expect(notificationsService.notifyUser).toHaveBeenCalledWith(
        'user-b',
        'org-1',
        expect.objectContaining({ type: 'event.invite' }),
      );
      // actor (user-creator) should NOT receive a duplicate notification.
      expect(notificationsService.notifyUser).not.toHaveBeenCalledWith(
        'user-creator',
        expect.anything(),
        expect.anything(),
      );
    });

    it('records activityLog and legalAudit', async () => {
      await service.splitSeries(
        'org-1',
        'event-1',
        { originalStartUtc: SPLIT_POINT, version: 1 },
        'user-creator',
        MembershipRole.MEMBER,
      );

      expect(activityLog.logActivity).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'planning.event.series.split' }),
      );
      expect(legalAudit.recordEvent).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'planning.event.series.split' }),
      );
    });

    it('throws BadRequestException when tail end is before or equal to tail start', async () => {
      await expect(
        service.splitSeries(
          'org-1',
          'event-1',
          {
            originalStartUtc: SPLIT_POINT,
            version: 1,
            startUtc: '2026-01-07T12:00:00Z',
            endUtc: '2026-01-07T11:00:00Z', // end before start
          },
          'user-creator',
          MembershipRole.MEMBER,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('logs error (Error instance) and does not throw when invite notifications reject', async () => {
      const notifyError = new Error('network timeout');
      notificationsService.notifyUser.mockRejectedValue(notifyError);

      // Fire-and-forget — must not propagate.
      await expect(
        service.splitSeries(
          'org-1',
          'event-1',
          { originalStartUtc: SPLIT_POINT, version: 1 },
          'user-creator',
          MembershipRole.MEMBER,
        ),
      ).resolves.not.toThrow();

      // Allow the promise chain to settle so the .catch() executes.
      await new Promise((r) => setImmediate(r));
    });

    it('logs "unknown error" and does not throw when notifications reject with a non-Error value', async () => {
      // Covers the `err instanceof Error ? err.message : 'unknown error'` else-branch.
      notificationsService.notifyUser.mockRejectedValue('plain string error');

      await expect(
        service.splitSeries(
          'org-1',
          'event-1',
          { originalStartUtc: SPLIT_POINT, version: 1 },
          'user-creator',
          MembershipRole.MEMBER,
        ),
      ).resolves.not.toThrow();

      await new Promise((r) => setImmediate(r));
    });

    it('does not send notifications when all attendees are the actor', async () => {
      // Set up: both attendees ARE the actor — filter removes all.
      repo.splitSeries.mockResolvedValue({
        updatedOriginal: recurringEvent,
        newEvent: makeEvent({
          id: 'event-tail',
          attendees: [{ ...ATTENDEE_A, userId: 'user-creator' }],
          exceptions: [],
        }),
      });

      await service.splitSeries(
        'org-1',
        'event-1',
        { originalStartUtc: SPLIT_POINT, version: 1 },
        'user-creator',
        MembershipRole.MEMBER,
      );

      await new Promise((r) => setImmediate(r));
      expect(notificationsService.notifyUser).not.toHaveBeenCalled();
    });
  });
});
