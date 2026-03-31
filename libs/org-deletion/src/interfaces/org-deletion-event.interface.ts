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

/**
 * Payload for organization deletion request event.
 */
export interface OrgDeletionRequestedEventPayload extends Record<
  string,
  unknown
> {
  /**
   * Organization ID to be deleted.
   */
  orgId: string;

  /**
   * Trigger source (user request or subscription expiry).
   */
  trigger: DeletionTrigger;

  /**
   * User ID who requested the deletion (null for system-triggered).
   */
  userId?: string;

  /**
   * Organization name (for audit logging).
   */
  orgName: string;

  /**
   * Timestamp when deletion was requested.
   */
  requestedAt: Date;

  /**
   * Timestamp when deletion is scheduled to execute.
   */
  scheduledAt: Date;
}

/**
 * Payload for organization deletion started event.
 */
export interface OrgDeletionStartedEventPayload extends Record<
  string,
  unknown
> {
  orgId: string;
  trigger: DeletionTrigger;
  startedAt: Date;
}

/**
 * Payload for organization deletion completed event.
 */
export interface OrgDeletionCompletedEventPayload extends Record<
  string,
  unknown
> {
  orgId: string;
  trigger: DeletionTrigger;
  orgName: string;
  requestedAt: Date;
  completedAt: Date;
}

/**
 * Payload for organization deletion failed event.
 */
export interface OrgDeletionFailedEventPayload extends Record<string, unknown> {
  orgId: string;
  trigger: DeletionTrigger;
  error: string;
  failedAt: Date;
}
