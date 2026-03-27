import { describe, it, expect, beforeEach } from 'vitest';
import { RecurrenceService } from './recurrence.service';
import { Event, EventAttendee, EventException } from '@prisma/client';

function makeEvent(
  overrides: Partial<Event> = {},
): Event & { attendees: EventAttendee[]; exceptions: EventException[] } {
  const base: Event = {
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
    ...overrides,
  };
  return { ...base, attendees: [], exceptions: [] };
}

describe('RecurrenceService', () => {
  let service: RecurrenceService;

  beforeEach(() => {
    service = new RecurrenceService();
  });

  describe('expand — single (non-recurring) event', () => {
    it('returns the event when it falls within the range', () => {
      const event = makeEvent();
      const from = new Date('2026-01-01T00:00:00Z');
      const to = new Date('2026-01-31T23:59:59Z');

      const results = service.expand(event, from, to);

      expect(results).toHaveLength(1);
      expect(results[0].eventId).toBe('event-1');
      expect(results[0].isRecurring).toBe(false);
      expect(results[0].isException).toBe(false);
    });

    it('returns empty when the event is outside the range', () => {
      const event = makeEvent({
        startUtc: new Date('2026-03-01T10:00:00Z'),
        endUtc: new Date('2026-03-01T11:00:00Z'),
      });
      const from = new Date('2026-01-01T00:00:00Z');
      const to = new Date('2026-01-31T23:59:59Z');

      expect(service.expand(event, from, to)).toHaveLength(0);
    });
  });

  describe('expand — recurring event (RRULE)', () => {
    it('expands weekly occurrences correctly', () => {
      const event = makeEvent({
        startUtc: new Date('2026-01-05T10:00:00Z'), // Monday
        endUtc: new Date('2026-01-05T11:00:00Z'),
        rrule: 'FREQ=WEEKLY;BYDAY=MO',
      });
      const from = new Date('2026-01-01T00:00:00Z');
      const to = new Date('2026-01-31T23:59:59Z');

      const results = service.expand(event, from, to);

      // Jan 5, 12, 19, 26 are Mondays
      expect(results).toHaveLength(4);
      expect(results[0].isRecurring).toBe(true);
      expect(results[0].startUtc).toEqual(new Date('2026-01-05T10:00:00Z'));
      expect(results[1].startUtc).toEqual(new Date('2026-01-12T10:00:00Z'));
    });

    it('preserves duration for each occurrence', () => {
      const event = makeEvent({
        startUtc: new Date('2026-01-05T10:00:00Z'),
        endUtc: new Date('2026-01-05T12:30:00Z'), // 2.5 hours
        rrule: 'FREQ=WEEKLY;BYDAY=MO',
      });
      const from = new Date('2026-01-01T00:00:00Z');
      const to = new Date('2026-01-12T23:59:59Z');

      const results = service.expand(event, from, to);

      expect(results).toHaveLength(2);
      const durationMs = 2.5 * 60 * 60 * 1000;
      for (const occ of results) {
        expect(occ.endUtc.getTime() - occ.startUtc.getTime()).toBe(durationMs);
      }
    });

    it('skips cancelled occurrences (isCancelled exception)', () => {
      const jan12 = new Date('2026-01-12T10:00:00Z');
      const event = makeEvent({
        startUtc: new Date('2026-01-05T10:00:00Z'),
        endUtc: new Date('2026-01-05T11:00:00Z'),
        rrule: 'FREQ=WEEKLY;BYDAY=MO',
      });
      const exception: EventException = {
        id: 'ex-1',
        eventId: 'event-1',
        originalStartUtc: jan12,
        startUtc: null,
        endUtc: null,
        isCancelled: true,
        title: null,
        description: null,
        location: null,
        createdAt: new Date(),
      };
      event.exceptions = [exception];

      const from = new Date('2026-01-01T00:00:00Z');
      const to = new Date('2026-01-31T23:59:59Z');

      const results = service.expand(event, from, to);

      // Jan 12 should be skipped → 3 results instead of 4
      expect(results).toHaveLength(3);
      expect(
        results.find((o) => o.startUtc.getTime() === jan12.getTime()),
      ).toBeUndefined();
    });

    it('applies exception field overrides', () => {
      const jan12 = new Date('2026-01-12T10:00:00Z');
      const event = makeEvent({
        startUtc: new Date('2026-01-05T10:00:00Z'),
        endUtc: new Date('2026-01-05T11:00:00Z'),
        rrule: 'FREQ=WEEKLY;BYDAY=MO',
      });
      const exception: EventException = {
        id: 'ex-1',
        eventId: 'event-1',
        originalStartUtc: jan12,
        startUtc: new Date('2026-01-12T14:00:00Z'),
        endUtc: new Date('2026-01-12T15:00:00Z'),
        isCancelled: false,
        title: 'Rescheduled',
        description: null,
        location: 'Room B',
        createdAt: new Date(),
      };
      event.exceptions = [exception];

      const from = new Date('2026-01-01T00:00:00Z');
      const to = new Date('2026-01-31T23:59:59Z');

      const results = service.expand(event, from, to);

      const overridden = results.find(
        (o) => o.originalStartUtc.getTime() === jan12.getTime(),
      );
      if (!overridden)
        throw new Error('Expected overridden occurrence to be found');
      expect(overridden.title).toBe('Rescheduled');
      expect(overridden.location).toBe('Room B');
      expect(overridden.startUtc).toEqual(new Date('2026-01-12T14:00:00Z'));
      expect(overridden.isException).toBe(true);
    });

    it('returns empty for malformed RRULE', () => {
      const event = makeEvent({ rrule: 'NOT_A_VALID_RRULE' });
      const from = new Date('2026-01-01T00:00:00Z');
      const to = new Date('2026-01-31T23:59:59Z');

      expect(service.expand(event, from, to)).toHaveLength(0);
    });
  });

  describe('isValidRrule', () => {
    it('returns true for a valid RRULE', () => {
      expect(service.isValidRrule('FREQ=DAILY;COUNT=10')).toBe(true);
    });

    it('returns false for an invalid RRULE', () => {
      expect(service.isValidRrule('INVALID')).toBe(false);
    });
  });
});
