// Matches Prisma $Enums.JobStatus — keep in sync with prisma/schema.prisma
type JobStatus = 'PENDING' | 'PROCESSING' | 'DONE' | 'FAILED';

/**
 * JobUpdateMessage
 *
 * Shape of the message published to Redis on every job state transition.
 *   - Published by: WorkerController (apps/worker-a)
 *   - Consumed by: JobsGateway (apps/api) via Redis Pub/Sub
 *   - Forwarded to: connected browser clients as the `job:update` WebSocket event
 *
 * Channel: `job:update:{tenantId}`
 */
export interface JobUpdateMessage {
  /** UUID of the job — same as `jobs.id` in Postgres. */
  jobId: string;
  /** Current state after this transition. */
  status: JobStatus;
  /** Organisation ID (tenant boundary). */
  tenantId: string;
  /** Auth0 sub of the user who submitted the job. Absent for system jobs. */
  userId?: string;
  /** Populated when status = DONE. */
  result?: Record<string, unknown>;
  /** Populated when status = FAILED. */
  error?: string;
  /** ISO-8601 timestamp of this transition. */
  updatedAt: string;
}
