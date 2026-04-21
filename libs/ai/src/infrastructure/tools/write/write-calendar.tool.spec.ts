import { createWriteCalendarTool } from './write-calendar.tool';
import type { PlanningService } from '@libs/planning';

describe('createWriteCalendarTool', () => {
  const mockPlanningService = {
    createEvent: vi.fn(),
  } as unknown as PlanningService;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should create a tool with the correct name and description', () => {
    const tool = createWriteCalendarTool(mockPlanningService, 'org-1', 'user-1');

    expect(tool.name).toBe('create_calendar_event');
    expect(tool.description).toContain('Create a new calendar event');
  });

  it('should call planningService.createEvent with correct params', async () => {
    const mockEvent = {
      id: 'evt-1',
      title: 'Team Lunch',
      description: 'Lunch with the team',
      location: 'Cafe',
      startUtc: new Date('2025-06-15T12:00:00Z'),
      endUtc: new Date('2025-06-15T13:00:00Z'),
      eventTimezone: 'Europe/Dublin',
      isAllDay: false,
    };

    (mockPlanningService.createEvent as ReturnType<typeof vi.fn>).mockResolvedValue(mockEvent);

    const tool = createWriteCalendarTool(mockPlanningService, 'org-1', 'user-1');
    const result = await tool.invoke({
      title: 'Team Lunch',
      description: 'Lunch with the team',
      location: 'Cafe',
      start: '2025-06-15T12:00:00',
      end: '2025-06-15T13:00:00',
      eventTimezone: 'Europe/Dublin',
    });

    expect(mockPlanningService.createEvent).toHaveBeenCalledWith('org-1', 'user-1', {
      title: 'Team Lunch',
      description: 'Lunch with the team',
      location: 'Cafe',
      start: expect.any(String),
      end: expect.any(String),
      isAllDay: false,
      eventTimezone: 'Europe/Dublin',
    });

    const callArgs = (mockPlanningService.createEvent as ReturnType<typeof vi.fn>).mock.calls[0]![2];
    expect(callArgs.start).toContain('T11:00:00');
    expect(callArgs.end).toContain('T12:00:00');

    const parsed = JSON.parse(result as string);
    expect(parsed.eventId).toBe('evt-1');
    expect(parsed.title).toBe('Team Lunch');
    expect(parsed.startLocal).toBeDefined();
    expect(parsed.eventTimezone).toBe('Europe/Dublin');
  });

  it('should default isAllDay to false and optional fields to null', async () => {
    const mockEvent = {
      id: 'evt-2',
      title: 'Quick Call',
      description: null,
      location: null,
      startUtc: new Date('2025-06-15T14:00:00Z'),
      endUtc: new Date('2025-06-15T14:30:00Z'),
      eventTimezone: 'UTC',
      isAllDay: false,
    };

    (mockPlanningService.createEvent as ReturnType<typeof vi.fn>).mockResolvedValue(mockEvent);

    const tool = createWriteCalendarTool(mockPlanningService, 'org-1', 'user-1');
    await tool.invoke({
      title: 'Quick Call',
      start: '2025-06-15T14:00:00',
      end: '2025-06-15T14:30:00',
      eventTimezone: 'UTC',
    });

    expect(mockPlanningService.createEvent).toHaveBeenCalledWith('org-1', 'user-1', {
      title: 'Quick Call',
      description: null,
      location: null,
      start: expect.stringContaining('T14:00:00'),
      end: expect.stringContaining('T14:30:00'),
      isAllDay: false,
      eventTimezone: 'UTC',
    });
  });
});
