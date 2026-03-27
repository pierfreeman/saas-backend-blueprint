import { Injectable } from '@nestjs/common';
import { RRule } from 'rrule';
import { Event, EventAttendee, EventException } from '@prisma/client';
import { EventOccurrence } from '../../planning.types';

/** Maximum number of occurrences returned per range query, as a safety cap. */
const MAX_OCCURRENCES_PER_QUERY = 500;

@Injectable()
export class RecurrenceService {
  /**
   * Expands an event (single or recurring) into a list of occurrences that fall
   * within [from, to] (inclusive on both ends).
   *
   * For recurring events:
   *  1. The RRULE is parsed and expanded using the `rrule` package.
   *  2. For each generated date, the matching EventException (if any) is applied:
   *     – isCancelled=true → occurrence is excluded from results.
   *     – Override fields (startUtc, endUtc, title, …) replace the template values.
   *
   * RRULE must NOT be pre-materialized. This method is the sole place where
   * occurrence timestamps are computed.
   */
  expand(
    event: Event & { attendees: EventAttendee[]; exceptions: EventException[] },
    from: Date,
    to: Date,
  ): EventOccurrence[] {
    const durationMs = event.endUtc.getTime() - event.startUtc.getTime();

    if (!event.rrule) {
      // Single (non-recurring) event — check if it overlaps the requested window.
      if (event.startUtc <= to && event.endUtc >= from) {
        return [
          this.buildOccurrence(
            event,
            event.startUtc,
            event.startUtc,
            event.endUtc,
            null,
          ),
        ];
      }
      return [];
    }

    let rule: RRule;
    try {
      rule = new RRule({
        ...RRule.parseString(event.rrule),
        dtstart: event.startUtc,
      });
    } catch {
      // Malformed RRULE stored in DB — skip expansion rather than crashing.
      return [];
    }

    const dates = rule
      .between(from, to, true)
      .slice(0, MAX_OCCURRENCES_PER_QUERY);

    // Build a lookup map: originalStartUtc (epoch ms) → exception record.
    const exceptionMap = new Map<number, EventException>(
      event.exceptions.map((ex) => [ex.originalStartUtc.getTime(), ex]),
    );

    const occurrences: EventOccurrence[] = [];

    for (const date of dates) {
      const ex = exceptionMap.get(date.getTime());

      // Cancelled occurrence — omit from results (EXDATE equivalent).
      if (ex?.isCancelled) {
        continue;
      }

      const effectiveStart = ex?.startUtc ?? date;
      const effectiveEnd = ex?.endUtc ?? new Date(date.getTime() + durationMs);

      occurrences.push(
        this.buildOccurrence(
          event,
          date,
          effectiveStart,
          effectiveEnd,
          ex ?? null,
        ),
      );
    }

    return occurrences;
  }

  /**
   * Validates that a given string is a parseable RFC 5545 RRULE.
   * Returns false if the string is invalid.
   */
  isValidRrule(rrule: string): boolean {
    try {
      RRule.parseString(rrule);
      return true;
    } catch {
      return false;
    }
  }

  private buildOccurrence(
    event: Event & { attendees: EventAttendee[] },
    originalStartUtc: Date,
    startUtc: Date,
    endUtc: Date,
    exception: EventException | null,
  ): EventOccurrence {
    return {
      eventId: event.id,
      originalStartUtc,
      startUtc,
      endUtc,
      title: exception?.title ?? event.title,
      description: exception?.description ?? event.description ?? null,
      location: exception?.location ?? event.location ?? null,
      isAllDay: event.isAllDay,
      eventTimezone: event.eventTimezone,
      rrule: event.rrule ?? null,
      isRecurring: !!event.rrule,
      isException: exception !== null,
      isCancelled: exception?.isCancelled ?? false,
      createdByUserId: event.createdByUserId,
      orgId: event.orgId,
      version: event.version,
      attendees: event.attendees,
    };
  }
}
