import { describe, it, expect, beforeEach } from 'vitest';
import { RecurrenceService } from './recurrence.service';
import { Event, EventAttendee, EventException } from '@libs/prisma-business';

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

    it('caps occurrences at rruleUntilUtc even when the RRULE string has no UNTIL', () => {
      // Simulates "This and Following" cancellation via updateEvent({ rruleUntilUtc })
      // where only the DB field is set but the rrule string was not truncated.
      const splitPoint = new Date('2026-01-12T10:00:00Z');
      const untilUtc = new Date(splitPoint.getTime() - 1); // 1 ms before split

      const event = makeEvent({
        rrule: 'FREQ=WEEKLY;BYDAY=MO', // open-ended — no UNTIL
        rruleUntilUtc: untilUtc,
      });
      const from = new Date('2026-01-01T00:00:00Z');
      const to = new Date('2026-01-31T23:59:59Z');

      const results = service.expand(event, from, to);

      // Only the 5 Jan occurrence should appear; 12 Jan and later must be excluded.
      expect(results.every((o) => o.originalStartUtc < splitPoint)).toBe(true);
      expect(
        results.some(
          (o) => o.originalStartUtc.getTime() >= splitPoint.getTime(),
        ),
      ).toBe(false);
    });

    it('does not restrict occurrences when rruleUntilUtc is null', () => {
      const event = makeEvent({
        rrule: 'FREQ=WEEKLY;BYDAY=MO',
        rruleUntilUtc: null,
      });
      const from = new Date('2026-01-01T00:00:00Z');
      const to = new Date('2026-01-31T23:59:59Z');

      // Jan has 4 Mondays: 5, 12, 19, 26
      expect(service.expand(event, from, to)).toHaveLength(4);
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

  // ── truncateRrule ──────────────────────────────────────────────────────────

  describe('truncateRrule', () => {
    it('adds UNTIL to a rule that has no UNTIL or COUNT', () => {
      const beforeUtc = new Date('2026-04-06T10:00:00Z');
      const result = service.truncateRrule('FREQ=DAILY', beforeUtc);

      // Must contain UNTIL and must not have the split occurrence.
      expect(result).toContain('FREQ=DAILY');
      expect(result).toContain('UNTIL=');
      expect(result).not.toContain('COUNT=');

      // The RRULE lib serialises UNTIL in iCalendar UTC format (YYYYMMDDTHHmmssZ).
      // Parse it manually so we can compare timestamps.
      const untilMatch = result.match(/UNTIL=(\d{8}T\d{6}Z)/);
      expect(untilMatch).not.toBeNull();
      const raw = untilMatch![1];
      const isoUntil = `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}T${raw.slice(9, 11)}:${raw.slice(11, 13)}:${raw.slice(13, 15)}Z`;
      expect(new Date(isoUntil).getTime()).toBeLessThan(beforeUtc.getTime());
    });

    it('replaces an existing UNTIL with the new truncation point', () => {
      const beforeUtc = new Date('2026-04-06T10:00:00Z');
      // Original rule already has UNTIL far in the future.
      const result = service.truncateRrule(
        'FREQ=WEEKLY;BYDAY=MO;UNTIL=20271231T235959Z',
        beforeUtc,
      );

      expect(result).toContain('FREQ=WEEKLY');
      // There should be exactly one UNTIL clause.
      const matches = result.match(/UNTIL=/g);
      expect(matches).toHaveLength(1);

      const untilMatch = result.match(/UNTIL=(\d{8}T\d{6}Z)/);
      expect(untilMatch).not.toBeNull();
      const raw = untilMatch![1];
      const isoUntil = `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}T${raw.slice(9, 11)}:${raw.slice(11, 13)}:${raw.slice(13, 15)}Z`;
      expect(new Date(isoUntil).getTime()).toBeLessThan(beforeUtc.getTime());
    });

    it('removes COUNT and adds UNTIL instead', () => {
      const beforeUtc = new Date('2026-04-06T10:00:00Z');
      const result = service.truncateRrule('FREQ=DAILY;COUNT=10', beforeUtc);

      expect(result).not.toContain('COUNT=');
      expect(result).toContain('UNTIL=');
    });

    it('removes both COUNT and UNTIL when both are present, then sets the new UNTIL', () => {
      const beforeUtc = new Date('2026-04-06T10:00:00Z');
      const result = service.truncateRrule(
        'FREQ=DAILY;COUNT=10;UNTIL=20271231T235959Z',
        beforeUtc,
      );

      expect(result).not.toContain('COUNT=');
      const untilMatch = result.match(/UNTIL=/g);
      expect(untilMatch).toHaveLength(1);
    });
  });

  // ── stripCountAndUntil ────────────────────────────────────────────────────

  describe('stripCountAndUntil', () => {
    it('removes COUNT from the rule', () => {
      const result = service.stripCountAndUntil('FREQ=DAILY;COUNT=10');
      expect(result).toContain('FREQ=DAILY');
      expect(result).not.toContain('COUNT=');
      expect(result).not.toContain('UNTIL=');
    });

    it('removes UNTIL from the rule', () => {
      const result = service.stripCountAndUntil(
        'FREQ=WEEKLY;BYDAY=MO;UNTIL=20271231T235959Z',
      );
      expect(result).toContain('FREQ=WEEKLY');
      expect(result).not.toContain('UNTIL=');
      expect(result).not.toContain('COUNT=');
    });

    it('removes both COUNT and UNTIL', () => {
      const result = service.stripCountAndUntil(
        'FREQ=MONTHLY;COUNT=6;UNTIL=20271231T235959Z',
      );
      expect(result).toContain('FREQ=MONTHLY');
      expect(result).not.toContain('COUNT=');
      expect(result).not.toContain('UNTIL=');
    });

    it('leaves a rule with neither COUNT nor UNTIL unchanged in substance', () => {
      const result = service.stripCountAndUntil('FREQ=YEARLY;BYYEARDAY=1');
      expect(result).toContain('FREQ=YEARLY');
      expect(result).not.toContain('COUNT=');
      expect(result).not.toContain('UNTIL=');
    });
  });
});
