import { DynamicStructuredTool } from '@langchain/core/tools';
import { DateTime } from 'luxon';
import { PlanningService } from '@libs/planning';

const WRITE_CALENDAR_SCHEMA = {
  type: 'object' as const,
  properties: {
    title: {
      type: 'string',
      description: 'Title of the event',
    },
    description: {
      type: 'string',
      description: 'Description of the event',
    },
    location: {
      type: 'string',
      description: 'Location of the event',
    },
    start: {
      type: 'string',
      description: 'Start time in the eventTimezone as ISO 8601 without Z suffix (e.g. 2025-06-15T09:00:00)',
    },
    end: {
      type: 'string',
      description: 'End time in the eventTimezone as ISO 8601 without Z suffix (e.g. 2025-06-15T10:00:00)',
    },
    isAllDay: {
      type: 'boolean',
      description: 'Whether the event is an all-day event. Defaults to false.',
    },
    eventTimezone: {
      type: 'string',
      description: 'IANA timezone for the event (e.g. Europe/Dublin, America/New_York)',
    },
  },
  required: ['title', 'start', 'end', 'eventTimezone'],
};

export function createWriteCalendarTool(
  planningService: PlanningService,
  orgId: string,
  userId: string,
): DynamicStructuredTool {
  return new DynamicStructuredTool({
    name: 'create_calendar_event',
    description:
      'Create a new calendar event for the current organization. ' +
      'Use this tool when the user asks to add, create, or schedule an event. ' +
      'Returns the created event details.',
    schema: WRITE_CALENDAR_SCHEMA,
    func: async (input: {
      title: string;
      description?: string;
      location?: string;
      start: string;
      end: string;
      isAllDay?: boolean;
      eventTimezone: string;
    }): Promise<string> => {
      const startUtc = DateTime.fromISO(input.start, { zone: input.eventTimezone }).toUTC().toISO();
      const endUtc = DateTime.fromISO(input.end, { zone: input.eventTimezone }).toUTC().toISO();

      const event = await planningService.createEvent(orgId, userId, {
        title: input.title,
        description: input.description ?? null,
        location: input.location ?? null,
        start: startUtc!,
        end: endUtc!,
        isAllDay: input.isAllDay ?? false,
        eventTimezone: input.eventTimezone,
      });

      return JSON.stringify({
        eventId: event.id,
        title: event.title,
        description: event.description,
        location: event.location,
        startLocal: event.startUtc.toLocaleString('en-GB', { timeZone: event.eventTimezone }),
        endLocal: event.endUtc.toLocaleString('en-GB', { timeZone: event.eventTimezone }),
        eventTimezone: event.eventTimezone,
        isAllDay: event.isAllDay,
      });
    },
  });
}
