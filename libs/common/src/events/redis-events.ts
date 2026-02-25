/**
 * Redis Event Definitions
 * Defines all events published between API and microservices
 */

export interface HeavyJobCreatedEvent {
  jobId: string;
  tenantId: string;
  payload: any;
  createdAt: Date;
}

/**
 * Event pattern constants
 * Used for subscribing and publishing to Redis channels
 */
export const REDIS_EVENTS = {
  HEAVY_JOB_CREATED: "heavy.job.created",
  // TODO: Add more event patterns as needed
  // HEAVY_JOB_COMPLETED: 'heavy.job.completed',
  // COMPUTE_A_TASK_STARTED: 'compute.a.task.started',
};
