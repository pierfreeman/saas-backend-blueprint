/**
 * Event types for organization deletion workflow.
 * These events are published to the event bus and consumed by the deletion worker.
 */

export const ORG_DELETION_EVENT_TYPES = {
  /**
   * Emitted when an organization deletion is requested (user or system).
   * Triggers the deletion workflow in the background worker.
   */
  DELETION_REQUESTED: 'org.deletion.requested',

  /**
   * Emitted when the deletion worker begins processing a deletion job.
   */
  DELETION_STARTED: 'org.deletion.started',

  /**
   * Emitted when organization deletion completes successfully.
   */
  DELETION_COMPLETED: 'org.deletion.completed',

  /**
   * Emitted when organization deletion fails.
   */
  DELETION_FAILED: 'org.deletion.failed',
} as const;

/**
 * Trigger source for organization deletion.
 */
export enum DeletionTrigger {
  /**
   * Deletion requested by an organization owner via API.
   */
  USER_REQUEST = 'USER_REQUEST',

  /**
   * Deletion triggered automatically due to subscription expiry and retention period.
   */
  SUBSCRIPTION_EXPIRY = 'SUBSCRIPTION_EXPIRY',
}
