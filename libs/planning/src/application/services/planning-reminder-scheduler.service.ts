import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { NotificationsService } from '@libs/notifications';
import { PlanningRepository } from '../../infrastructure/repositories/planning.repository';
import { RecurrenceService } from './recurrence.service';

/**
 * Runs a periodic sweep every 5 minutes to find events whose reminder window
 * has opened and sends in-app notifications to all attendees.
 *
 * Strategy:
 *  - Non-recurring events: fire once when `now >= startUtc - reminderMinutes`.
 *  - Recurring events:   fire once per occurrence when `now >= occurrenceStart - reminderMinutes`,
 *                        using `lastReminderOccurrenceUtc` as a high-water mark so each
 *                        occurrence is only notified once.
 *
 * The sweep window for recurring expansion: [lastReminder, now + maxReminderMs].
 * `maxReminderMs` is 1440 min (1 day) — the largest configurable preset.
 */
@Injectable()
export class PlanningReminderSchedulerService {
  private readonly logger = new Logger(PlanningReminderSchedulerService.name);

  private static readonly MAX_REMINDER_MINUTES = 1440;

  constructor(
    private readonly repo: PlanningRepository,
    private readonly recurrenceService: RecurrenceService,
    private readonly notificationsService: NotificationsService,
  ) {}

  @Cron(CronExpression.EVERY_5_MINUTES, { name: 'planning-reminder-sweep' })
  async sweep(): Promise<void> {
    this.logger.debug('Planning reminder sweep started');

    let candidates: Awaited<
      ReturnType<typeof this.repo.findEventsWithReminders>
    >;
    try {
      candidates = await this.repo.findEventsWithReminders();
    } catch (err) {
      this.logger.error('Failed to query reminder candidates', err);
      return;
    }

    if (candidates.length === 0) return;

    const now = new Date();
    const maxLookaheadMs =
      PlanningReminderSchedulerService.MAX_REMINDER_MINUTES * 60_000;

    for (const event of candidates) {
      try {
        await this.#processEvent(event, now, maxLookaheadMs);
      } catch (err) {
        this.logger.error(
          `Reminder sweep failed for event ${event.id}`,
          err instanceof Error ? err.message : String(err),
        );
      }
    }

    this.logger.debug(
      `Planning reminder sweep done — checked ${candidates.length} event(s)`,
    );
  }

  async #processEvent(
    event: Awaited<
      ReturnType<typeof this.repo.findEventsWithReminders>
    >[number],
    now: Date,
    maxLookaheadMs: number,
  ): Promise<void> {
    if (event.reminderMinutes == null) return;

    const reminderMs = event.reminderMinutes * 60_000;
    const attendeeIds = event.attendees.map((a) => a.userId);
    if (attendeeIds.length === 0) return;

    if (!event.rrule) {
      // ── Non-recurring ─────────────────────────────────────────────────────
      // Only fire if we haven't sent a reminder yet (lastReminderOccurrenceUtc is null)
      // and the reminder window is open: now >= startUtc - reminderMinutes.
      if (event.lastReminderOccurrenceUtc !== null) return;
      const dueAt = new Date(event.startUtc.getTime() - reminderMs);
      if (now < dueAt) return;

      await this.#sendReminder(event, event.startUtc, attendeeIds);
    } else {
      // ── Recurring ─────────────────────────────────────────────────────────
      // Expand occurrences in the window [lastReminderOccurrenceUtc, now + maxLookahead].
      // Process them in chronological order; stop after the first undue one.
      const expandFrom =
        event.lastReminderOccurrenceUtc ?? new Date(event.startUtc.getTime());
      const expandTo = new Date(now.getTime() + maxLookaheadMs);

      const occurrences = this.recurrenceService.expand(
        event,
        expandFrom,
        expandTo,
      );

      for (const occ of occurrences) {
        if (occ.isCancelled) continue;

        const occStart = new Date(occ.startUtc);

        // Skip occurrences at or before the last-reminded one (dedup).
        if (
          event.lastReminderOccurrenceUtc !== null &&
          occStart <= event.lastReminderOccurrenceUtc
        ) {
          continue;
        }

        const dueAt = new Date(occStart.getTime() - reminderMs);
        if (now < dueAt) break; // occurrences are ordered; all later ones are also not yet due.

        await this.#sendReminder(event, occStart, attendeeIds);
      }
    }
  }

  async #sendReminder(
    event: {
      id: string;
      orgId: string;
      title: string;
      reminderMinutes: number | null;
    },
    occurrenceStartUtc: Date,
    attendeeIds: string[],
  ): Promise<void> {
    const minutes = event.reminderMinutes!;
    const body =
      minutes >= 60
        ? `"${event.title}" starts in ${minutes / 60} hour${minutes / 60 > 1 ? 's' : ''}`
        : `"${event.title}" starts in ${minutes} minute${minutes > 1 ? 's' : ''}`;

    await this.notificationsService.notifyManyUsers(attendeeIds, event.orgId, {
      type: 'event.reminder',
      title: 'Event reminder',
      body,
      metadata: { entityRef: { type: 'event', id: event.id } },
    });

    await this.repo.updateLastReminderSent(event.id, occurrenceStartUtc);

    this.logger.log(
      `Sent reminder for event ${event.id} (occurrence ${occurrenceStartUtc.toISOString()}) to ${attendeeIds.length} attendee(s)`,
    );
  }
}
