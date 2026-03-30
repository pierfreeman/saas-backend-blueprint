import { EventAttendee } from '@libs/prisma-business';

/**
 * A single expanded occurrence of an event.
 *
 * For non-recurring events, this mirrors the master Event fields directly.
 * For recurring events, each occurrence is generated dynamically from the RRULE;
 * overridden fields (title, times, etc.) are sourced from the matching EventException.
 */
export interface EventOccurrence {
  /** ID of the master Event record. */
  eventId: string;
  /** The RRULE-computed start of this occurrence (UTC). Used as the exception key. */
  originalStartUtc: Date;
  /** Effective start time (UTC). May differ from originalStartUtc if overridden by an exception. */
  startUtc: Date;
  /** Effective end time (UTC). */
  endUtc: Date;
  /** Display title. May be overridden by an exception. */
  title: string;
  description: string | null;
  location: string | null;
  isAllDay: boolean;
  /** IANA timezone used for display and recurrence expansion. */
  eventTimezone: string;
  /** Original RFC 5545 RRULE string (null for single events). */
  rrule: string | null;
  /** True when the master event has a recurrence rule. */
  isRecurring: boolean;
  /** True when this occurrence has an overriding EventException record. */
  isException: boolean;
  /** True when this occurrence has been cancelled via an EventException with isCancelled=true. */
  isCancelled: boolean;
  /** DB user ID of the event creator. */
  createdByUserId: string;
  orgId: string;
  /** Current version of the master event (used for optimistic locking on updates). */
  version: number;
  attendees: EventAttendee[];
}
