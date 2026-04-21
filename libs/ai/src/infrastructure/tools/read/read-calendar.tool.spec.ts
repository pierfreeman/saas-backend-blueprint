import { createReadCalendarTool } from './read-calendar.tool';
import type { PlanningService } from '@libs/planning';
import type { EventOccurrence } from '@libs/planning';
import type { RSVPStatus } from '@libs/prisma-business';

describe('createReadCalendarTool', () => {
  const mockPlanningService = {
    listEvents: vi.fn(),
  } as unknown as PlanningService;

  it('should create a tool with the correct name and description', () => {
    const tool = createReadCalendarTool(mockPlanningService, 'org-1');

    expect(tool.name).toBe('list_calendar_events');
    expect(tool.description).toContain('calendar events');
  });

  it('should call planningService.listEvents with orgId and parsed dates', async () => {
    const mockEvents: EventOccurrence[] = [
      {
        eventId: 'evt-1',
        originalStartUtc: new Date('2025-06-01T09:00:00Z'),
        startUtc: new Date('2025-06-01T09:00:00Z'),
        endUtc: new Date('2025-06-01T10:00:00Z'),
        title: 'Standup',
        description: null,
        location: 'Room A',
        isAllDay: false,
        eventTimezone: 'UTC',
        rrule: null,
        isRecurring: false,
        isException: false,
        isCancelled: false,
        createdByUserId: 'user-1',
        orgId: 'org-1',
        version: 1,
        attendees: [
          { userId: 'user-1', status: 'YES' as RSVPStatus } as EventOccurrence['attendees'][0],
        ],
      },
    ];

    (mockPlanningService.listEvents as ReturnType<typeof vi.fn>).mockResolvedValue(mockEvents);

    const tool = createReadCalendarTool(mockPlanningService, 'org-1');
    const result = await tool.invoke({
      from: '2025-06-01T00:00:00Z',
      to: '2025-06-30T23:59:59Z',
    });

    expect(mockPlanningService.listEvents).toHaveBeenCalledWith(
      'org-1',
      new Date('2025-06-01T00:00:00Z'),
      new Date('2025-06-30T23:59:59Z'),
    );

    const parsed = JSON.parse(result as string);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].title).toBe('Standup');
    expect(parsed[0].location).toBe('Room A');
    expect(parsed[0].startLocal).toBeDefined();
    expect(parsed[0].endLocal).toBeDefined();
    expect(parsed[0].eventTimezone).toBe('UTC');
    expect(parsed[0].attendees).toEqual([{ userId: 'user-1', status: 'YES' }]);
  });

  it('should return an empty array when no events exist', async () => {
    (mockPlanningService.listEvents as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const tool = createReadCalendarTool(mockPlanningService, 'org-1');
    const result = await tool.invoke({
      from: '2025-06-01T00:00:00Z',
      to: '2025-06-30T23:59:59Z',
    });

    expect(JSON.parse(result as string)).toEqual([]);
  });
});
