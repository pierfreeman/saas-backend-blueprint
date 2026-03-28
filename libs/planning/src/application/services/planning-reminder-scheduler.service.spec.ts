import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { PlanningReminderSchedulerService } from './planning-reminder-scheduler.service';
import { PlanningRepository } from '../../infrastructure/repositories/planning.repository';
import { RecurrenceService } from './recurrence.service';
import { NotificationsService } from '@libs/notifications';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type EventStub = {
  id: string;
  orgId: string;
  title: string;
  startUtc: Date;
  endUtc: Date;
  isAllDay: boolean;
  eventTimezone: string;
  rrule: string | null;
  rruleUntilUtc: Date | null;
  version: number;
  metadata: null;
  reminderMinutes: number | null;
  lastReminderOccurrenceUtc: Date | null;
  deletedAt: null;
  createdAt: Date;
  updatedAt: Date;
  attendees: { userId: string }[];
  exceptions: never[];
  createdByUserId: string;
  description: string | null;
  location: string | null;
};

function makeEvent(overrides: Partial<EventStub> = {}): EventStub {
  return {
    id: 'event-1',
    orgId: 'org-1',
    createdByUserId: 'user-1',
    title: 'Stand-up',
    description: null,
    location: null,
    startUtc: new Date('2026-03-29T09:00:00Z'),
    endUtc: new Date('2026-03-29T09:30:00Z'),
    isAllDay: false,
    eventTimezone: 'UTC',
    rrule: null,
    rruleUntilUtc: null,
    version: 1,
    metadata: null,
    reminderMinutes: 15,
    lastReminderOccurrenceUtc: null,
    deletedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    attendees: [{ userId: 'user-a' }, { userId: 'user-b' }],
    exceptions: [],
    ...overrides,
  };
}

function makeOccurrence(startUtc: Date, isCancelled = false) {
  return {
    eventId: 'event-1',
    originalStartUtc: startUtc,
    startUtc,
    endUtc: new Date(startUtc.getTime() + 30 * 60_000),
    title: 'Stand-up',
    description: null,
    location: null,
    isAllDay: false,
    eventTimezone: 'UTC',
    rrule: 'FREQ=DAILY',
    isRecurring: true,
    isException: false,
    isCancelled,
    createdByUserId: 'user-1',
    orgId: 'org-1',
    version: 1,
    attendees: [],
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PlanningReminderSchedulerService', () => {
  let service: PlanningReminderSchedulerService;
  let repo: {
    findEventsWithReminders: ReturnType<typeof vi.fn>;
    updateLastReminderSent: ReturnType<typeof vi.fn>;
  };
  let recurrence: { expand: ReturnType<typeof vi.fn> };
  let notifications: { notifyManyUsers: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    repo = {
      findEventsWithReminders: vi.fn().mockResolvedValue([]),
      updateLastReminderSent: vi.fn().mockResolvedValue(undefined),
    };
    recurrence = { expand: vi.fn().mockReturnValue([]) };
    notifications = { notifyManyUsers: vi.fn().mockResolvedValue([]) };

    const module = await Test.createTestingModule({
      providers: [
        PlanningReminderSchedulerService,
        { provide: PlanningRepository, useValue: repo },
        { provide: RecurrenceService, useValue: recurrence },
        { provide: NotificationsService, useValue: notifications },
      ],
    }).compile();

    service = module.get(PlanningReminderSchedulerService);
  });

  // ── sweep orchestration ────────────────────────────────────────────────────

  describe('sweep()', () => {
    it('does nothing when there are no candidates', async () => {
      repo.findEventsWithReminders.mockResolvedValue([]);
      await service.sweep();
      expect(notifications.notifyManyUsers).not.toHaveBeenCalled();
    });

    it('continues processing remaining events if one throws', async () => {
      const badEvent = makeEvent({ id: 'bad-event', reminderMinutes: 5 });
      const goodEvent = makeEvent({
        id: 'good-event',
        reminderMinutes: 15,
        startUtc: new Date(Date.now() - 30 * 60_000), // 30 min ago → window opened long ago
      });

      repo.findEventsWithReminders.mockResolvedValue([badEvent, goodEvent]);
      // Make updateLastReminderSent throw for the first event
      repo.updateLastReminderSent
        .mockRejectedValueOnce(new Error('db error'))
        .mockResolvedValue(undefined);

      await expect(service.sweep()).resolves.not.toThrow();
      // The second good event should still have triggered notifyManyUsers
      expect(notifications.notifyManyUsers).toHaveBeenCalledWith(
        expect.any(Array),
        goodEvent.orgId,
        expect.objectContaining({ type: 'event.reminder' }),
      );
    });

    it('aborts early and logs when findEventsWithReminders rejects', async () => {
      repo.findEventsWithReminders.mockRejectedValue(new Error('DB down'));
      await expect(service.sweep()).resolves.not.toThrow();
      expect(notifications.notifyManyUsers).not.toHaveBeenCalled();
    });
  });

  // ── non-recurring events ───────────────────────────────────────────────────

  describe('non-recurring event', () => {
    it('sends a reminder when now >= startUtc - reminderMinutes', async () => {
      // start in 5 min, reminder 15 min → window opened 10 min ago
      const startUtc = new Date(Date.now() + 5 * 60_000);
      const event = makeEvent({ startUtc, reminderMinutes: 15 });

      repo.findEventsWithReminders.mockResolvedValue([event]);
      await service.sweep();

      expect(notifications.notifyManyUsers).toHaveBeenCalledOnce();
      expect(notifications.notifyManyUsers).toHaveBeenCalledWith(
        ['user-a', 'user-b'],
        'org-1',
        expect.objectContaining({
          type: 'event.reminder',
          title: 'Event reminder',
        }),
      );
      expect(repo.updateLastReminderSent).toHaveBeenCalledWith(
        'event-1',
        startUtc,
      );
    });

    it('does not send a reminder when the window has not opened yet', async () => {
      // start in 60 min, reminder 15 min → due in 45 min
      const startUtc = new Date(Date.now() + 60 * 60_000);
      const event = makeEvent({ startUtc, reminderMinutes: 15 });

      repo.findEventsWithReminders.mockResolvedValue([event]);
      await service.sweep();

      expect(notifications.notifyManyUsers).not.toHaveBeenCalled();
      expect(repo.updateLastReminderSent).not.toHaveBeenCalled();
    });

    it('does not send a duplicate reminder when lastReminderOccurrenceUtc is already set', async () => {
      const startUtc = new Date(Date.now() - 5 * 60_000); // past
      const event = makeEvent({
        startUtc,
        reminderMinutes: 15,
        lastReminderOccurrenceUtc: startUtc, // already sent
      });

      repo.findEventsWithReminders.mockResolvedValue([event]);
      await service.sweep();

      expect(notifications.notifyManyUsers).not.toHaveBeenCalled();
    });

    it('skips events with no attendees', async () => {
      const startUtc = new Date(Date.now() - 5 * 60_000);
      const event = makeEvent({ startUtc, reminderMinutes: 15, attendees: [] });

      repo.findEventsWithReminders.mockResolvedValue([event]);
      await service.sweep();

      expect(notifications.notifyManyUsers).not.toHaveBeenCalled();
    });

    it('skips events when reminderMinutes is null', async () => {
      const startUtc = new Date(Date.now() - 5 * 60_000);
      const event = makeEvent({ startUtc, reminderMinutes: null });

      repo.findEventsWithReminders.mockResolvedValue([event]);
      await service.sweep();

      expect(notifications.notifyManyUsers).not.toHaveBeenCalled();
    });
  });

  // ── notification body ──────────────────────────────────────────────────────

  describe('reminder body text', () => {
    async function captureBody(reminderMinutes: number): Promise<string> {
      const startUtc = new Date(Date.now() + 1 * 60_000); // 1 min from now
      const event = makeEvent({
        startUtc,
        reminderMinutes,
        title: 'My Meeting',
      });
      repo.findEventsWithReminders.mockResolvedValue([event]);
      await service.sweep();
      const call = notifications.notifyManyUsers.mock.calls[0];
      return (call[2] as { body: string }).body;
    }

    it('uses "minute" (singular) for 1 minute', async () => {
      expect(await captureBody(1)).toBe('"My Meeting" starts in 1 minute');
    });

    it('uses "minutes" (plural) for values < 60', async () => {
      expect(await captureBody(15)).toBe('"My Meeting" starts in 15 minutes');
    });

    it('uses "1 hour" for exactly 60 minutes', async () => {
      expect(await captureBody(60)).toBe('"My Meeting" starts in 1 hour');
    });

    it('uses "hours" (plural) for 120 minutes', async () => {
      expect(await captureBody(120)).toBe('"My Meeting" starts in 2 hours');
    });

    it('uses "hours" for values between 60 and 1440', async () => {
      expect(await captureBody(180)).toBe('"My Meeting" starts in 3 hours');
    });
  });

  // ── recurring events ───────────────────────────────────────────────────────

  describe('recurring event', () => {
    it('sends a reminder for a due occurrence with no previous reminder', async () => {
      const occ1Start = new Date(Date.now() - 2 * 60_000); // 2 min ago
      const event = makeEvent({
        rrule: 'FREQ=DAILY',
        reminderMinutes: 15,
        lastReminderOccurrenceUtc: null,
      });
      recurrence.expand.mockReturnValue([makeOccurrence(occ1Start)]);

      repo.findEventsWithReminders.mockResolvedValue([event]);
      await service.sweep();

      expect(notifications.notifyManyUsers).toHaveBeenCalledOnce();
      expect(repo.updateLastReminderSent).toHaveBeenCalledWith(
        'event-1',
        occ1Start,
      );
    });

    it('skips an occurrence already covered by the high-water mark', async () => {
      const pastOcc = new Date('2026-03-28T09:00:00Z');
      const event = makeEvent({
        rrule: 'FREQ=DAILY',
        reminderMinutes: 15,
        lastReminderOccurrenceUtc: pastOcc, // already sent for this one
      });
      // expand returns the same occurrence that was already reminded
      recurrence.expand.mockReturnValue([makeOccurrence(pastOcc)]);

      repo.findEventsWithReminders.mockResolvedValue([event]);
      await service.sweep();

      expect(notifications.notifyManyUsers).not.toHaveBeenCalled();
    });

    it('advances the high-water mark for each due occurrence', async () => {
      const occ1 = new Date(Date.now() - 30 * 60_000);
      const occ2 = new Date(Date.now() - 5 * 60_000);
      const event = makeEvent({
        rrule: 'FREQ=HOURLY',
        reminderMinutes: 15,
        lastReminderOccurrenceUtc: null,
      });
      recurrence.expand.mockReturnValue([
        makeOccurrence(occ1),
        makeOccurrence(occ2),
      ]);

      repo.findEventsWithReminders.mockResolvedValue([event]);
      await service.sweep();

      expect(notifications.notifyManyUsers).toHaveBeenCalledTimes(2);
      expect(repo.updateLastReminderSent).toHaveBeenNthCalledWith(
        1,
        'event-1',
        occ1,
      );
      expect(repo.updateLastReminderSent).toHaveBeenNthCalledWith(
        2,
        'event-1',
        occ2,
      );
    });

    it('stops at the first occurrence not yet due (ascending order)', async () => {
      const dueOcc = new Date(Date.now() - 5 * 60_000);
      const futureOcc = new Date(Date.now() + 60 * 60_000); // 1 h from now, reminder 15 min → not due
      const event = makeEvent({
        rrule: 'FREQ=HOURLY',
        reminderMinutes: 15,
        lastReminderOccurrenceUtc: null,
      });
      recurrence.expand.mockReturnValue([
        makeOccurrence(dueOcc),
        makeOccurrence(futureOcc),
      ]);

      repo.findEventsWithReminders.mockResolvedValue([event]);
      await service.sweep();

      expect(notifications.notifyManyUsers).toHaveBeenCalledOnce();
      expect(repo.updateLastReminderSent).toHaveBeenCalledWith(
        'event-1',
        dueOcc,
      );
    });

    it('skips cancelled occurrences', async () => {
      const cancelledOcc = new Date(Date.now() - 5 * 60_000);
      const event = makeEvent({
        rrule: 'FREQ=DAILY',
        reminderMinutes: 15,
        lastReminderOccurrenceUtc: null,
      });
      recurrence.expand.mockReturnValue([makeOccurrence(cancelledOcc, true)]);

      repo.findEventsWithReminders.mockResolvedValue([event]);
      await service.sweep();

      expect(notifications.notifyManyUsers).not.toHaveBeenCalled();
    });

    it('passes attendee IDs from the master event to notifyManyUsers', async () => {
      const occ = new Date(Date.now() - 5 * 60_000);
      const event = makeEvent({
        rrule: 'FREQ=DAILY',
        reminderMinutes: 15,
        attendees: [{ userId: 'u-1' }, { userId: 'u-2' }, { userId: 'u-3' }],
      });
      recurrence.expand.mockReturnValue([makeOccurrence(occ)]);

      repo.findEventsWithReminders.mockResolvedValue([event]);
      await service.sweep();

      expect(notifications.notifyManyUsers).toHaveBeenCalledWith(
        ['u-1', 'u-2', 'u-3'],
        'org-1',
        expect.any(Object),
      );
    });

    it('expands from lastReminderOccurrenceUtc when set', async () => {
      const highWater = new Date('2026-03-28T09:00:00Z');
      const event = makeEvent({
        rrule: 'FREQ=DAILY',
        reminderMinutes: 15,
        lastReminderOccurrenceUtc: highWater,
      });
      recurrence.expand.mockReturnValue([]);

      repo.findEventsWithReminders.mockResolvedValue([event]);
      await service.sweep();

      // expand should have been called with highWater as the from param
      expect(recurrence.expand).toHaveBeenCalledWith(
        event,
        highWater,
        expect.any(Date),
      );
    });

    it('expands from startUtc when lastReminderOccurrenceUtc is null', async () => {
      const event = makeEvent({
        rrule: 'FREQ=DAILY',
        reminderMinutes: 15,
        lastReminderOccurrenceUtc: null,
        startUtc: new Date('2026-03-01T08:00:00Z'),
      });
      recurrence.expand.mockReturnValue([]);

      repo.findEventsWithReminders.mockResolvedValue([event]);
      await service.sweep();

      expect(recurrence.expand).toHaveBeenCalledWith(
        event,
        event.startUtc,
        expect.any(Date),
      );
    });
  });

  // ── entityRef metadata ─────────────────────────────────────────────────────

  describe('notification metadata', () => {
    it('includes entityRef with type "event" and the event id', async () => {
      const startUtc = new Date(Date.now() + 1 * 60_000);
      const event = makeEvent({ id: 'evt-xyz', startUtc, reminderMinutes: 5 });
      repo.findEventsWithReminders.mockResolvedValue([event]);

      await service.sweep();

      expect(notifications.notifyManyUsers).toHaveBeenCalledWith(
        expect.any(Array),
        expect.any(String),
        expect.objectContaining({
          metadata: { entityRef: { type: 'event', id: 'evt-xyz' } },
        }),
      );
    });
  });
});
