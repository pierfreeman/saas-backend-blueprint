import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import {
  ForbiddenException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { MembershipRole, RSVPStatus } from '@prisma/client';
import { PlanningService } from './planning.service';
import { PlanningRepository } from '../../infrastructure/repositories/planning.repository';
import { RecurrenceService } from './recurrence.service';
import { ActivityLogService } from '@libs/activity-log';
import { LegalAuditService } from '@libs/legal-audit';
import { NotificationsService } from '@libs/notifications';

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
    findEventById: ReturnType<typeof vi.fn>;
    updateEvent: ReturnType<typeof vi.fn>;
    softDeleteEvent: ReturnType<typeof vi.fn>;
    upsertAttendee: ReturnType<typeof vi.fn>;
    findAttendee: ReturnType<typeof vi.fn>;
    findAttendees: ReturnType<typeof vi.fn>;
    upsertException: ReturnType<typeof vi.fn>;
  };
  let activityLog: { logActivity: ReturnType<typeof vi.fn> };
  let legalAudit: { recordEvent: ReturnType<typeof vi.fn> };
  let notificationsService: { notifyUser: ReturnType<typeof vi.fn> };
  let recurrenceService: {
    expand: ReturnType<typeof vi.fn>;
    isValidRrule: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    repo = {
      createEvent: vi.fn(),
      findEventsByRange: vi.fn(),
      findEventById: vi.fn(),
      updateEvent: vi.fn(),
      softDeleteEvent: vi.fn(),
      upsertAttendee: vi.fn(),
      findAttendee: vi.fn(),
      findAttendees: vi.fn(),
      upsertException: vi.fn(),
    };
    activityLog = { logActivity: vi.fn() };
    legalAudit = { recordEvent: vi.fn() };
    notificationsService = { notifyUser: vi.fn().mockResolvedValue({}) };
    recurrenceService = {
      expand: vi.fn().mockReturnValue([]),
      isValidRrule: vi.fn().mockReturnValue(true),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PlanningService,
        { provide: PlanningRepository, useValue: repo },
        { provide: RecurrenceService, useValue: recurrenceService },
        { provide: ActivityLogService, useValue: activityLog },
        { provide: LegalAuditService, useValue: legalAudit },
        { provide: NotificationsService, useValue: notificationsService },
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

      await service.rsvp('org-1', 'event-1', 'other-user', RSVPStatus.NO);

      // Notification is fire-and-forget, so we wait a tick
      await new Promise((r) => setImmediate(r));
      expect(notificationsService.notifyUser).toHaveBeenCalledWith(
        'creator',
        'org-1',
        expect.objectContaining({ type: 'event.rsvp' }),
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
  });
});
