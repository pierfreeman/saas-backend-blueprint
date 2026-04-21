import { DynamicStructuredTool } from '@langchain/core/tools';
import { PlanningService } from '@libs/planning';

const READ_CALENDAR_SCHEMA = {
  type: 'object' as const,
  properties: {
    from: {
      type: 'string',
      description: 'Start of the date range in ISO 8601 format (e.g. 2025-01-01T00:00:00.000Z)',
    },
    to: {
      type: 'string',
      description: 'End of the date range in ISO 8601 format (e.g. 2025-01-31T23:59:59.999Z)',
    },
  },
  required: ['from', 'to'],
};

export function createReadCalendarTool(
  planningService: PlanningService,
  orgId: string,
): DynamicStructuredTool {
  return new DynamicStructuredTool({
    name: 'list_calendar_events',
    description:
      'List calendar events for the current organization within a date range. ' +
      'Use this tool when the user asks about their schedule, upcoming events, ' +
      'or what is on their calendar. Returns event titles, local times, ' +
      'locations, attendees, and recurrence info.',
    schema: READ_CALENDAR_SCHEMA,
    func: async (input: { from: string; to: string }): Promise<string> => {
      const from = new Date(input.from);
      const to = new Date(input.to);

      const events = await planningService.listEvents(orgId, from, to);

      return JSON.stringify(
        events.map((event) => ({
          eventId: event.eventId,
          title: event.title,
          description: event.description,
          location: event.location,
          startLocal: event.startUtc.toLocaleString('en-GB', { timeZone: event.eventTimezone }),
          endLocal: event.endUtc.toLocaleString('en-GB', { timeZone: event.eventTimezone }),
          eventTimezone: event.eventTimezone,
          isAllDay: event.isAllDay,
          isRecurring: event.isRecurring,
          isCancelled: event.isCancelled,
          attendees: event.attendees.map((a) => ({
            userId: a.userId,
            status: a.status,
          })),
        })),
      );
    },
  });
}
