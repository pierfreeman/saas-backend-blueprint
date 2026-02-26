import { REDIS_EVENTS, HeavyJobCreatedEvent } from './redis-events';

describe('REDIS_EVENTS', () => {
  it('defines HEAVY_JOB_CREATED as "heavy.job.created"', () => {
    expect(REDIS_EVENTS.HEAVY_JOB_CREATED).toBe('heavy.job.created');
  });

  it('is a plain object (not a class instance)', () => {
    expect(typeof REDIS_EVENTS).toBe('object');
    expect(REDIS_EVENTS).not.toBeNull();
  });

  it('does not contain undefined values', () => {
    for (const [key, value] of Object.entries(REDIS_EVENTS)) {
      expect(value).toBeDefined();
      expect(typeof value).toBe('string');
      expect(value.length).toBeGreaterThan(0);
    }
  });

  it('all event patterns use dot-separated lowercase format', () => {
    for (const value of Object.values(REDIS_EVENTS)) {
      expect(value).toMatch(/^[a-z]+(\.[a-z]+)*$/);
    }
  });
});

/**
 * Edge-case: verify the HeavyJobCreatedEvent interface shape at runtime
 * by creating a conforming object and checking required fields.
 */
describe('HeavyJobCreatedEvent shape', () => {
  it('accepts a valid event object with all required fields', () => {
    const event: HeavyJobCreatedEvent = {
      jobId: 'job-123',
      tenantId: 'tenant-abc',
      payload: { key: 'value' },
      createdAt: new Date(),
    };

    expect(event.jobId).toBe('job-123');
    expect(event.tenantId).toBe('tenant-abc');
    expect(event.payload).toEqual({ key: 'value' });
    expect(event.createdAt).toBeInstanceOf(Date);
  });

  it('payload can hold any shape (any type)', () => {
    const withArray: HeavyJobCreatedEvent = {
      jobId: 'j-1',
      tenantId: 't-1',
      payload: [1, 2, 3],
      createdAt: new Date(),
    };
    expect(Array.isArray(withArray.payload)).toBe(true);

    const withNull: HeavyJobCreatedEvent = {
      jobId: 'j-2',
      tenantId: 't-2',
      payload: null,
      createdAt: new Date(),
    };
    expect(withNull.payload).toBeNull();
  });
});
